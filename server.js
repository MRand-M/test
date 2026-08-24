const express = require("express");
const {
  createProxyMiddleware,
  responseInterceptor
} = require("http-proxy-middleware");

const app = express();

const TARGET = "https://wiki.warthunder.com";
const PORT = process.env.PORT || 10000;


/*
 * =========================================================
 * 检查是否允许代理
 * =========================================================
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
 * =========================================================
 * Health check
 * =========================================================
 */

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});


/*
 * =========================================================
 * 外部资源代理
 *
 * 例如：
 *
 * /__proxy?url=https://avatars.warthunder.com/img/test.png
 *
 * ↓
 *
 * https://avatars.warthunder.com/img/test.png
 * =========================================================
 */

app.get("/__proxy", async (req, res) => {

    try {

        const originalUrl = req.query.url;

        if (!originalUrl) {
            return res.status(400).send("Missing url");
        }

        const targetUrl = new URL(originalUrl);

        if (!isAllowedHost(targetUrl.hostname)) {
            return res.status(403).send("Domain not allowed");
        }

        console.log("Resource:", targetUrl.href);

        const response = await fetch(targetUrl.href, {
            headers: {
                "User-Agent":
                    req.headers["user-agent"] ||
                    "Mozilla/5.0",

                "Referer":
                    "https://wiki.warthunder.com/"
            },
            redirect: "follow"
        });

        if (!response.ok) {
            return res
                .status(response.status)
                .send(`Resource returned ${response.status}`);
        }

        /*
         * 复制 Content-Type
         */

        const contentType =
            response.headers.get("content-type");

        if (contentType) {
            res.setHeader(
                "Content-Type",
                contentType
            );
        }

        /*
         * Cache
         */

        res.setHeader(
            "Cache-Control",
            "public, max-age=3600"
        );

        /*
         * 返回资源
         */

        const buffer =
            Buffer.from(
                await response.arrayBuffer()
            );

        res.send(buffer);

    } catch (error) {

        console.error(
            "Resource proxy error:",
            error
        );

        res
            .status(500)
            .send("Resource proxy error");
    }
});


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


            /*
             * 只使用一个 proxyRes
             */

            proxyRes: responseInterceptor(
                async (
                    responseBuffer,
                    proxyRes,
                    req,
                    res
                ) => {

                    const contentType =
                        proxyRes.headers[
                            "content-type"
                        ] || "";


                    /*
                     * =================================================
                     * HTML
                     * =================================================
                     */

                    if (
                        contentType.includes(
                            "text/html"
                        )
                    ) {

                        let html =
                            responseBuffer.toString(
                                "utf8"
                            );


                        const protocol =
                            req.headers[
                                "x-forwarded-proto"
                            ] || "https";

                        const host =
                            req.headers.host;

                        const proxyBase =
                            `${protocol}://${host}`;


                        /*
                         * =================================================
                         * 处理绝对 HTTPS URL
                         *
                         * https://avatars.warthunder.com/...
                         *
                         * ↓
                         *
                         * /__proxy?url=...
                         * =================================================
                         */

                        html = html.replace(
                            /https:\/\/[a-zA-Z0-9.-]+(?:\/[^"'<>\\s)]*)?/g,
                            (url) => {

                                try {

                                    const parsed =
                                        new URL(url);

                                    if (
                                        !isAllowedHost(
                                            parsed.hostname
                                        )
                                    ) {
                                        return url;
                                    }


                                    return (
                                        proxyBase +
                                        "/__proxy?url=" +
                                        encodeURIComponent(
                                            url
                                        )
                                    );

                                } catch {

                                    return url;
                                }
                            }
                        );


                        /*
                         * =================================================
                         * 处理 //avatars.warthunder.com/...
                         * =================================================
                         */

                        html = html.replace(
                            /(["'(=])\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\/[^"'<>\\s)]*)/g,
                            (
                                match,
                                prefix,
                                hostname,
                                path
                            ) => {

                                if (
                                    !isAllowedHost(
                                        hostname
                                    )
                                ) {
                                    return match;
                                }


                                const original =
                                    `https://${hostname}${path}`;


                                return (
                                    prefix +
                                    proxyBase +
                                    "/__proxy?url=" +
                                    encodeURIComponent(
                                        original
                                    )
                                );
                            }
                        );


                        /*
                         * 返回修改后的 HTML
                         */

                        return Buffer.from(
                            html,
                            "utf8"
                        );
                    }


                    /*
                     * =================================================
                     * 其他资源
                     *
                     * JS / CSS / PNG / SVG 等保持原样
                     * =================================================
                     */

                    return responseBuffer;
                }
            )
        }
    })
);


/*
 * =========================================================
 * Start
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
