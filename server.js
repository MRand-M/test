const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

const TARGET = "https://1939.giaory.xyz";

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
        // 允许浏览器通过你的代理访问资源
        delete proxyRes.headers["x-frame-options"];
        delete proxyRes.headers["content-security-policy"];

        // 防止目标站点把 cookie 锁死在原域名
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy running on port ${PORT}`);
});