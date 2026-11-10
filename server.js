// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = Number(process.env.PORT) || 3e3;
var HOST = "0.0.0.0";
app.use(express.static(__dirname, {
  extensions: ["html"],
  index: ["index.html"]
}));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
var editions = ["en", "zh-hant", "zh-hans", "ko", "id", "vi"];
for (const ed of editions) {
  app.get(`/${ed}`, (req, res) => {
    res.redirect(`/${ed}/`);
  });
  app.get(`/${ed}/`, (req, res) => {
    res.sendFile(path.join(__dirname, ed, "index.html"));
  });
}
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.listen(PORT, HOST, () => {
  console.log(`JIZURA server running at http://${HOST}:${PORT}`);
});
