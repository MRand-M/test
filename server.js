const express = require("express");
const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");

const app = express();

const TARGET = "https://1939.giaory.xyz";
const PORT = process.env.PORT || 10000;

app.get("/health", (req, res) => {
  res.send("OK");
});

app.use(
  "/",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: true,
    ws: true,
    followRedirects: true,

    selfHandleResponse: true,

    on: {
      proxyReq(proxyReq) {
        proxyReq.setHeader("Referer", TARGET + "/");
        proxyReq.setHeader("Origin", TARGET);
      },

      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const contentType = proxyRes.headers["content-type"] || "";

        // 只修改 HTML
        if (contentType.includes("text/html")) {
          let body = responseBuffer.toString("utf8");

          // 把原网站绝对地址改成当前 Render 代理地址
          const host = req.headers.host;
          const protocol = req.headers["x-forwarded-proto"] || "https";
          const proxyUrl = `${protocol}://${host}`;

          body = body.replaceAll(TARGET, proxyUrl);

          return Buffer.from(body, "utf8");
        }

        return responseBuffer;
      }),

      proxyRes(proxyRes) {
        // 删除可能阻止嵌入的安全策略
        delete proxyRes.headers["x-frame-options"];
        delete proxyRes.headers["content-security-policy"];

        // 修改 Cookie
        if (proxyRes.headers["set-cookie"]) {
          proxyRes.headers["set-cookie"] =
            proxyRes.headers["set-cookie"].map(cookie =>
              cookie
                .replace(/;\s*Domain=[^;]+/i, "")
                .replace(/;\s*Secure/gi, "")
            );
        }

        // 防止压缩后的 HTML 无法修改
        delete proxyRes.headers["content-encoding"];
      }
    }
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy running on port ${PORT}`);
});
