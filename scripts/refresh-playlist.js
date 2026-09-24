var fs = require("fs");
var https = require("https");
var path = require("path");

var PLAYLIST_ID = "PLZgTkNmA_H4I&si=vdD49aN58jK7aUKL";
var FEED_URL = "https://www.youtube.com/feeds/videos.xml?playlist_id=" + encodeURIComponent(PLAYLIST_ID);
var OUT = path.resolve(__dirname, "..", "playlist.json");

function fetchText(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, {
      headers: {
        "User-Agent": "rayban-youtube-display playlist refresher"
      }
    }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error("HTTP " + res.statusCode + " fetching " + url));
        res.resume();
        return;
      }

      var chunks = [];
      res.setEncoding("utf8");
      res.on("data", function (chunk) {
        chunks.push(chunk);
      });
      res.on("end", function () {
        resolve(chunks.join(""));
      });
    }).on("error", reject);
  });
}

function textBetween(source, startTag, endTag) {
  var start = source.indexOf(startTag);
  if (start === -1) {
    return "";
  }
  start += startTag.length;
  var end = source.indexOf(endTag, start);
  if (end === -1) {
    return "";
  }
  return decodeXml(source.slice(start, end).trim());
}

function attr(source, name) {
  var match = source.match(new RegExp(name + '="([^"]*)"'));
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripText(value, max) {
  var cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (max && cleaned.length > max) {
    return cleaned.slice(0, max - 1).trim() + "...";
  }
  return cleaned;
}

function parseFeed(xml) {
  var title = textBetween(xml, "<title>", "</title>") || "Meta Display App";
  var authorBlock = textBetween(xml, "<author>", "</author>");
  var channel = textBetween(authorBlock, "<name>", "</name>") || "YouTube playlist";
  var updated = textBetween(xml, "<published>", "</published>") || "";
  var entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  var videos = entries.map(function (entry) {
    var mediaGroup = textBetween(entry, "<media:group>", "</media:group>");
    var thumbnailMatch = mediaGroup.match(/<media:thumbnail\s+[^>]*>/);
    return {
      id: textBetween(entry, "<yt:videoId>", "</yt:videoId>"),
      title: stripText(textBetween(entry, "<title>", "</title>"), 140),
      author: stripText(textBetween(textBetween(entry, "<author>", "</author>"), "<name>", "</name>"), 80),
      published: textBetween(entry, "<published>", "</published>"),
      updated: textBetween(entry, "<updated>", "</updated>"),
      thumbnail: thumbnailMatch ? attr(thumbnailMatch[0], "url") : "",
      description: stripText(textBetween(mediaGroup, "<media:description>", "</media:description>"), 220)
    };
  }).filter(function (video) {
    return /^[A-Za-z0-9_-]{11}$/.test(video.id);
  });

  return {
    playlistId: PLAYLIST_ID,
    title: stripText(title, 90),
    channel: stripText(channel, 80),
    sourceUrl: "https://youtube.com/playlist?list=" + PLAYLIST_ID,
    feedUrl: FEED_URL,
    published: updated,
    generatedAt: new Date().toISOString(),
    videos: videos
  };
}

function comparable(data) {
  var copy = JSON.parse(JSON.stringify(data));
  delete copy.generatedAt;
  return copy;
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (error) {
    return null;
  }
}

fetchText(FEED_URL)
  .then(function (xml) {
    var data = parseFeed(xml);
    if (!data.videos.length) {
      throw new Error("Playlist feed returned no videos");
    }
    var existing = readExisting();
    if (existing && JSON.stringify(comparable(existing)) === JSON.stringify(comparable(data))) {
      console.log("Playlist unchanged: " + data.videos.length + " videos");
      return;
    }
    fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
    console.log("Wrote " + data.videos.length + " videos to " + OUT);
  })
  .catch(function (error) {
    console.error(error.message);
    process.exit(1);
  });
