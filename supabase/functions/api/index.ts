// The Magical Camera API. One function, actions chosen by `action` in the JSON body.
// login   {username, pin}                         -> {token, username}
// conjure {token, photo(b64 jpeg), reflection, plateId, takenAt, lat, lon}
//         -> {creature, imageUrl}   (photo read by a vision model, creature painted in by an image model)
//         -> {creature, needsBake:true} when the painter is unavailable (client bakes a clockwork creature, then calls save)
// save    {token, image(b64 jpeg), plateId, takenAt, lat, lon, meta} -> {creature, imageUrl}
// list    {username?}                              -> {walkers, creatures}
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { InferenceClient } from "npm:@huggingface/inference@4.0.5";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const HF = Deno.env.get("HF_TOKEN") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const MOODS = ["angry", "sleepy", "calm", "joyful", "sad", "anxious", "curious", "grateful", "quiet"];
const VISION = ["Qwen/Qwen2.5-VL-7B-Instruct", "Qwen/Qwen2.5-VL-32B-Instruct", "zai-org/GLM-4.5V", "Qwen/Qwen2.5-VL-3B-Instruct"];
const PAINTERS = ["black-forest-labs/FLUX.1-Kontext-dev", "black-forest-labs/FLUX.2-klein-9B"];

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/^data:[^,]+,/, "")), (c) => c.charCodeAt(0));
const publicUrl = (path: string) => db.storage.from("prints").getPublicUrl(path).data.publicUrl;

async function walkerFromToken(token: string) {
  if (!token) return null;
  const { data } = await db.from("walker_secrets").select("username").eq("token_hash", await sha(token)).maybeSingle();
  return data?.username ?? null;
}

async function readPhoto(photoB64: string, reflection: string) {
  const hf = new InferenceClient(HF);
  const ask = `You are the spirit inside a magical clockwork camera. A walker photographed a place where a creature might hide, then wrote how their walk felt.
Their reflection: """${(reflection || "").slice(0, 500)}"""
Look at the photo. Pick the single most interesting real object or surface in it (a branch, a doorway, a wall, a lamp, a puddle...).
Decide the walker's mood from the reflection, choosing exactly one of: ${MOODS.join(", ")}. If nothing fits, use quiet.
Invent ONE small creature that is born from that object and carries that mood: e.g. a branch + relaxed = a calm mossy twig sprite; a branch + frustrated = a smouldering ember-bark imp.
Reply with JSON only, no prose:
{"subject":"the object, 1-3 words","material":"what the creature is made of, 2-5 words","where":"left|center|right","height":"top|middle|bottom","mood":"one mood","kind":"a 1-2 word species name, Title Case","name":"a short invented given name","lore":"one sentence of lore, under 20 words, present tense","look":"what it looks like, under 25 words"}`;
  let lastErr = "";
  for (const model of VISION) {
    try {
      const r = await hf.chatCompletion({
        model, max_tokens: 350, temperature: 0.8,
        messages: [{ role: "user", content: [{ type: "text", text: ask }, { type: "image_url", image_url: { url: "data:image/jpeg;base64," + photoB64.replace(/^data:[^,]+,/, "") } }] }],
      });
      const txt = r.choices?.[0]?.message?.content || "";
      const m = String(txt).match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no json: " + String(txt).slice(0, 120));
      const o = JSON.parse(m[0]);
      if (!MOODS.includes(o.mood)) o.mood = "quiet";
      o.vision = model;
      return o;
    } catch (e) { lastErr = `${model}: ${(e as Error).message}`; console.warn("vision failed", lastErr); }
  }
  throw new Error("vision unavailable: " + lastErr);
}

async function paint(photoB64: string, c: Record<string, string>) {
  const hf = new InferenceClient(HF);
  const spot = `${c.where === "center" ? "centre" : c.where} ${c.height === "middle" ? "middle" : c.height === "top" ? "upper part" : "lower part"}`;
  const prompt = `Bring part of the ${c.subject} in this photo to life as one small ${c.mood} creature made of ${c.material}: ${c.look}. It sits half hidden at the ${spot} of the scene, as if it has always lived there, lit by the same light as the photo, softly glowing, painted in a gentle storybook style. Exactly one creature. Keep everything else in the photo unchanged.`;
  let lastErr = "";
  for (const model of PAINTERS) {
    try {
      const blob = await hf.imageToImage({ model, inputs: new Blob([b64ToBytes(photoB64)], { type: "image/jpeg" }), parameters: { prompt } });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "image/jpeg", painter: model };
    } catch (e) { lastErr = `${model}: ${(e as Error).message}`; console.warn("paint failed", lastErr); }
  }
  throw new Error("painter unavailable: " + lastErr);
}

async function store(username: string, b: Record<string, unknown>, bytes: Uint8Array, type: string, meta: Record<string, unknown>) {
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const path = `${username}/${String(b.plateId).replace(/[^a-zA-Z0-9_-]/g, "")}.${ext}`;
  const up = await db.storage.from("prints").upload(path, bytes, { contentType: type, upsert: true });
  if (up.error) throw up.error;
  const row = {
    username, plate_id: String(b.plateId), taken_at: b.takenAt ? new Date(Number(b.takenAt)).toISOString() : null,
    kind: meta.kind, name: meta.name, mood: meta.mood, subject: meta.subject ?? null, lore: meta.lore, reflection: String(b.reflection ?? meta.reflection ?? "").slice(0, 600),
    painter: meta.painter, lat: b.lat ?? null, lon: b.lon ?? null, image_path: path,
  };
  const { data, error } = await db.from("creatures").upsert(row, { onConflict: "username,plate_id" }).select().single();
  if (error) throw error;
  return { creature: data, imageUrl: publicUrl(path) + "?v=" + Date.now() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
  try {
    if (b.action === "login") {
      const u = String(b.username || "").trim().toLowerCase(), pin = String(b.pin || "");
      if (!/^[a-z0-9_]{2,20}$/.test(u)) return json({ error: "Names are 2 to 20 letters, numbers or _." }, 400);
      if (!/^\d{4}$/.test(pin)) return json({ error: "The PIN is 4 digits." }, 400);
      const ph = await sha("rpgwalk:" + u + ":" + pin), token = crypto.randomUUID() + crypto.randomUUID();
      const { data: sec } = await db.from("walker_secrets").select("pin_hash").eq("username", u).maybeSingle();
      if (sec && sec.pin_hash !== ph) return json({ error: "That name is taken, or the PIN is wrong." }, 403);
      if (!sec) {
        const w = await db.from("walkers").insert({ username: u });
        if (w.error) return json({ error: "That name is taken, or the PIN is wrong." }, 403);
        await db.from("walker_secrets").insert({ username: u, pin_hash: ph, token_hash: await sha(token) });
      } else await db.from("walker_secrets").update({ token_hash: await sha(token) }).eq("username", u);
      return json({ token, username: u, created: !sec });
    }
    if (b.action === "list") {
      const { data: walkers } = await db.from("walkers").select("username,created_at").order("created_at");
      let q = db.from("creatures").select("*").order("created_at", { ascending: false }).limit(200);
      if (b.username) q = q.eq("username", String(b.username).toLowerCase());
      const { data: creatures } = await q;
      return json({ walkers, creatures: (creatures || []).map(({ reflection: _private, ...c }) => ({ ...c, imageUrl: publicUrl(c.image_path) })) });   // reflections stay private
    }
    const username = await walkerFromToken(String(b.token || ""));
    if (!username) return json({ error: "Sign in again." }, 401);
    if (b.action === "conjure") {
      if (!HF) return json({ error: "The server has no Hugging Face token yet." }, 503);
      const meta: Record<string, any> = await readPhoto(b.photo, b.reflection);
      try {
        const p = await paint(b.photo, meta);
        meta.painter = p.painter;
        return json(await store(username, b, p.bytes, p.type, meta));
      } catch (e) {
        return json({ creature: meta, needsBake: true, why: (e as Error).message });
      }
    }
    if (b.action === "save") {
      return json(await store(username, b, b64ToBytes(b.image), "image/jpeg", b.meta || {}));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Something broke." }, 500);
  }
});
