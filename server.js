const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

const TARGET = "https://wiki.warthunder.com/";

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.use(
  "/",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: true,
    ws: true,
    followRedirects: true,

    on: {
      proxyReq(proxyReq) {
        proxyReq.setHeader("Referer", TARGET + "/");
        proxyReq.setHeader("Origin", TARGET);
      },

      proxyRes(proxyRes) {
        delete proxyRes.headers["x-frame-options"];
        delete proxyRes.headers["content-security-policy"];

        if (proxyRes.headers["set-cookie"]) {
          proxyRes.headers["set-cookie"] =
            proxyRes.headers["set-cookie"].map(cookie =>
              cookie
                .replace(/;\s*Domain=[^;]+/i, "")
                .replace(/;\s*Secure/gi, "")
            );
        }
      }
    }
  })
);

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy running on port ${PORT}`);
});
