import fetch from "node-fetch";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const RAW_API = "https://api.fabdl.com";

// --- Telegram helper functions ---
async function sendMessage(chatId, text, opts = {}) {
  await fetch(`${API_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...opts }),
  });
}

async function sendAudio(chatId, audioUrl, caption) {
  await fetch(`${API_URL}/sendAudio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      audio: audioUrl,
      caption,
      parse_mode: "HTML",
    }),
  });
}

// --- Core Handler ---
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("Spotify Telegram bot is live 🎵");
    }

    const body = req.body;
    const msg = body.message;
    if (!msg || !msg.text) return res.status(200).end();

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (!text.includes("spotify.com/")) {
      await sendMessage(chatId, "❌ Please send a valid Spotify link (track or playlist).");
      return res.status(200).end();
    }

    // Determine type (track or playlist)
    const isTrack = text.includes("spotify.com/track");
    const isPlaylist = text.includes("spotify.com/playlist");

    if (!isTrack && !isPlaylist) {
      await sendMessage(chatId, "⚠️ Only Spotify track or playlist links are supported for now.");
      return res.status(200).end();
    }

    await sendMessage(chatId, "🎧 Getting your Spotify info...");

    if (isTrack) {
      await processTrack(chatId, text);
    } else if (isPlaylist) {
      await processPlaylist(chatId, text);
    }

    res.status(200).end();
  } catch (err) {
    console.error("Error:", err);
    res.status(200).end();
  }
}

// --- Handle Track ---
async function processTrack(chatId, spotifyUrl) {
  try {
    const songInfoRes = await fetch(`${RAW_API}/spotify/get?url=${spotifyUrl}`);
    const songInfo = await songInfoRes.json();

    const data = songInfo?.result;
    if (!data?.id) {
      await sendMessage(chatId, "❌ Couldn't fetch track info.");
      return;
    }

    const durationSec = Math.floor(data.duration_ms / 1000);
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    const durationFormatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    await sendMessage(chatId, `🎶 Downloading: ${data.name}`);

    const dlRes = await fetch(`${RAW_API}/spotify/mp3-convert-task/${data.gid}/${data.id}`);
    const dlData = await dlRes.json();

    if (dlData?.result?.download_url) {
      const url = `${RAW_API}${dlData.result.download_url}`;
      const caption = `
<b>🎵 Song Downloaded Successfully!</b>
🎧 <b>Title:</b> <code>${data.name}</code>
👤 <b>Artist:</b> <code>${data.artists}</code>
⏱️ <b>Duration:</b> <code>${durationFormatted}</code>
🔗 <a href="${spotifyUrl}">Open in Spotify</a>
      `;
      await sendAudio(chatId, url, caption);
    } else {
      await sendMessage(chatId, "❌ Failed to download this song.");
    }
  } catch (err) {
    console.error("Track error:", err);
    await sendMessage(chatId, "⚠️ Error processing track.");
  }
}

// --- Handle Playlist ---
async function processPlaylist(chatId, playlistUrl) {
  try {
    const listRes = await fetch(`${RAW_API}/spotify/get?url=${playlistUrl}`);
    const listData = await listRes.json();

    const tracks = listData?.result?.tracks;
    if (!tracks || tracks.length === 0) {
      await sendMessage(chatId, "❌ Couldn't fetch playlist or it's empty.");
      return;
    }

    await sendMessage(chatId, `📀 Playlist detected!\nTotal Tracks: ${tracks.length}\nDownloading...`);

    // Send one by one with short delay to avoid spam
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      await sendMessage(chatId, `(${i + 1}/${tracks.length}) 🎶 ${track.name}`);

      // get convert link
      try {
        const dlRes = await fetch(`${RAW_API}/spotify/mp3-convert-task/${track.gid}/${track.id}`);
        const dlData = await dlRes.json();
        if (dlData?.result?.download_url) {
          const url = `${RAW_API}${dlData.result.download_url}`;
          const caption = `
<b>🎵 ${track.name}</b>
👤 <b>Artist:</b> <code>${track.artists}</code>
🔗 <a href="${track.external_urls?.spotify || playlistUrl}">Open in Spotify</a>
          `;
          await sendAudio(chatId, url, caption);
        }
      } catch {
        await sendMessage(chatId, `❌ Skipped: ${track.name}`);
      }

      // Small delay (Telegram rate limit)
      await new Promise((r) => setTimeout(r, 2000));
    }

    await sendMessage(chatId, "✅ Playlist completed!");
  } catch (err) {
    console.error("Playlist error:", err);
    await sendMessage(chatId, "⚠️ Error processing playlist.");
  }
}
