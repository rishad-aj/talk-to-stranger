import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
export const sb = createClient(
  window.NEXT_PUBLIC_SUPABASE_URL || window.SB_URL,
  window.NEXT_PUBLIC_SUPABASE_ANON_KEY || window.SB_KEY
);
export const ROOM_ONLY = "not.like.dm.*";
export async function sendMessage(row) {
  const { error } = await sb.from("messages").insert({ ...row, ts: row.ts ?? Date.now() });
  if (error) throw error;
}
export async function fetchRoom(limit = 100, beforeTs = null) {
  let q = sb.from("messages").select("id,ts,sender,type,text,url,dur,size,reply_to,flagged").not("type", "like", "dm.*").order("ts", { ascending: false }).limit(limit);
  if (beforeTs != null) q = q.lt("ts", beforeTs);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).reverse();
}
export function subscribeRoom(onInsert, onUpdate, onDelete) {
  return sb.channel("room").on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
    if (p.eventType === "INSERT" && onInsert) onInsert(p.new);
    if (p.eventType === "UPDATE" && onUpdate) onUpdate(p.new);
    if (p.eventType === "DELETE" && onDelete) onDelete(p.old);
  }).subscribe();
}
export async function editMessage(ts, sender, text) {
  const { error } = await sb.from("messages").update({ text }).eq("ts", ts).eq("sender", sender);
  if (error) throw error;
}
export async function deleteMessage(ts, sender) {
  const { error } = await sb.from("messages").delete().eq("ts", ts).eq("sender", sender);
  if (error) throw error;
}
