const express = require("express");
const {
  createProxyMiddleware,
  responseInterceptor
} = require("http-proxy-middleware");

const app = express();

const TARGET = "https://wiki.warthunder.com";
const PORT = process.env.PORT || 10000;

/*
 * 允许代理的 War Thunder 域名
 */
const ALLOWED_HOSTS = [
  "wiki.warthunder.com",
  "avatars.warthunder.com",
  "static.encyclopedia.warthunder.com"
];

/*
 * 检查一个 URL 是否属于允许的 War Thunder 域名
 */
function isAllowedHost(hostname) {
  if (!hostname) return false;

  hostname = hostname.toLowerCase();

  return (
    hostname === "warthunder.com" ||
    hostname.endsWith(".warthunder.com") ||
    hostname === "encyclopedia.warthunder.com" ||
    hostname.endsWith(".encyclopedia.warthunder.com")
  );
}

/*
 * 把原网站 URL 转换成 Proxy URL
 *
 * 例如：
 *
 * https://avatars.warthunder.com/img/test.png
 *
 * ↓
 *
 * https://你的render.onrender.com/__proxy/https://avatars.warthunder.com/img/test.png
 */
function makeProxyUrl(originalUrl, req) {
  try {
    const url = new URL(originalUrl);

    if (!isAllowedHost(url.hostname)) {
      return originalUrl;
    }

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    return `${protocol}://${host}/__proxy/${originalUrl}`;
  } catch {
    return originalUrl;
  }
}

/*
 * Health check
 */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/*
 * =========================================================
 * 动态资源 Proxy
 *
 * /__proxy/https://avatars.warthunder.com/xxx.png
 *
 * 会自动请求：
 *
 * https://avatars.warthunder.com/xxx.png
 * =========================================================
 */

app.use(
  "/__proxy",
  async (req, res, next) => {
    try {
      const originalUrl = req.url.substring(1);

      if (!originalUrl.startsWith("http://") &&
          !originalUrl.startsWith("https://")) {
        return res.status(400).send("Invalid proxy URL");
      }

      const targetUrl = new URL(originalUrl);

      if (!isAllowedHost(targetUrl.hostname)) {
        return res.status(403).send("Domain not allowed");
      }

      createProxyMiddleware({
        target: targetUrl.origin,
        changeOrigin: true,
        secure: true,
        followRedirects: true,

        pathRewrite: () => {
          return targetUrl.pathname + targetUrl.search;
        },

        on: {
          proxyReq(proxyReq) {
            proxyReq.setHeader(
              "Referer",
              `https://wiki.warthunder.com/`
            );

            proxyReq.setHeader(
              "Origin",
              "https://wiki.warthunder.com"
            );
          }
        }
      })(req, res, next);

    } catch (error) {
      console.error("Resource proxy error:", error);
      res.status(500).send("Proxy error");
    }
  }
);

/*
 * =========================================================
 * Wiki 主站 Proxy
 * =========================================================
 */

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
        proxyReq.setHeader(
          "Referer",
          TARGET + "/"
        );

        proxyReq.setHeader(
          "Origin",
          TARGET
        );
      },

      proxyRes: responseInterceptor(
        async (responseBuffer, proxyRes, req, res) => {

          const contentType =
            proxyRes.headers["content-type"] || "";

          /*
           * 只修改 HTML
           */
          if (
            contentType.includes("text/html")
          ) {

            let body =
              responseBuffer.toString("utf8");

            const protocol =
              req.headers["x-forwarded-proto"] || "https";

            const host =
              req.headers.host;

            const proxyBase =
              `${protocol}://${host}`;

            /*
             * =================================================
             * 自动处理绝对 URL
             * =================================================
             */

            body = body.replace(
              /https?:\/\/[a-zA-Z0-9.-]+(?:\.[a-zA-Z]{2,})(?:\/[^\s"'<>)]*)?/g,
              (url) => {
                try {
                  const parsed = new URL(url);

                  if (
                    isAllowedHost(parsed.hostname)
                  ) {
                    return makeProxyUrl(
                      url,
                      req
                    );
                  }

                  return url;

                } catch {
                  return url;
                }
              }
            );

            /*
             * =================================================
             * 处理 protocol-relative URL
             *
             * //avatars.warthunder.com/xxx.png
             * =================================================
             */

            body = body.replace(
              /(["'(=])\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\/[^"'<>)]*)/g,
              (match, prefix, hostName, path) => {

                if (
                  !isAllowedHost(hostName)
                ) {
                  return match;
                }

                const original =
                  `https://${hostName}${path}`;

                return (
                  prefix +
                  makeProxyUrl(original, req)
                );
              }
            );

            return Buffer.from(
              body,
              "utf8"
            );
          }

          /*
           * 其他资源不修改
           */
          return responseBuffer;
        }
      ),

      /*
       * 删除阻止嵌入的 Header
       */
      proxyRes(proxyRes) {

        delete proxyRes.headers[
          "x-frame-options"
        ];

        delete proxyRes.headers[
          "content-security-policy"
        ];

        /*
         * Cookie Domain 去掉
         */
        if (
          proxyRes.headers["set-cookie"]
        ) {

          proxyRes.headers["set-cookie"] =
            proxyRes.headers["set-cookie"].map(
              cookie =>
                cookie
                  .replace(
                    /;\s*Domain=[^;]+/i,
                    ""
                  )
                  .replace(
                    /;\s*Secure/gi,
                    ""
                  )
            );
        }

        /*
         * HTML 被重新处理，所以不能继续
         * 使用原来的压缩编码
         */
        delete proxyRes.headers[
          "content-encoding"
        ];
      }
    }
  })
);

/*
 * =========================================================
 * Start server
 * =========================================================
 */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Proxy running on port ${PORT}`
    );
  }
);
