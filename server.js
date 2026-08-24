const express = require("express");
const {
    createProxyMiddleware,
    responseInterceptor
} = require("http-proxy-middleware");

const app = express();

const TARGET = "https://1939.giaory.xyz";
const PORT = process.env.PORT || 10000;

/*
 * 允许的资源域名。
 *
 * 可以继续往这里添加 CDN / 图片服务器。
 * War Thunder 的子域名全部允许。
 */
function isAllowedHost(hostname) {
    return true;
}

/*
 * 把外部资源 URL 转换成当前 Proxy 的 URL
 */
function makeProxyUrl(url, req) {
    const protocol =
        req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    return (
        `${protocol}://${host}/__resource?url=` +
        encodeURIComponent(url)
    );
}

/*
 * Health check
 */
app.get("/health", (req, res) => {
    res.send("OK");
});


/*
 * ==========================================================
 * 外部资源 Proxy
 *
 * 例如：
 *
 * /__resource?url=https://avatars.warthunder.com/xxx.png
 *
 * ==========================================================
 */

app.get("/__resource", async (req, res) => {

    try {

        const target = req.query.url;

        if (!target) {
            return res.status(400).send("Missing URL");
        }

        const url = new URL(target);

        if (!isAllowedHost(url.hostname)) {
            return res.status(403).send("Domain not allowed");
        }

        const response = await fetch(url.href, {
            redirect: "follow",
            headers: {
                "User-Agent":
                    req.headers["user-agent"] ||
                    "Mozilla/5.0",

                "Referer":
                    TARGET + "/"
            }
        });

        if (!response.ok) {
            return res
                .status(response.status)
                .send(`Resource returned ${response.status}`);
        }

        const contentType =
            response.headers.get("content-type");

        if (contentType) {
            res.setHeader(
                "Content-Type",
                contentType
            );
        }

        res.setHeader(
            "Cache-Control",
            "public, max-age=3600"
        );

        const buffer =
            Buffer.from(
                await response.arrayBuffer()
            );

        res.send(buffer);

    } catch (error) {

        console.error(
            "Resource error:",
            error
        );

        res.status(500).send("Resource error");
    }
});


/*
 * ==========================================================
 * 主网站 Proxy
 * ==========================================================
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

                proxyReq.setHeader(
                    "User-Agent",
                    "Mozilla/5.0"
                );
            },


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
                     * 只重写 HTML
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
                         * ------------------------------------------------
                         * 绝对 URL
                         *
                         * https://avatars.warthunder.com/xxx.png
                         * ------------------------------------------------
                         */

                        html = html.replace(
                            /https?:\/\/[^"'\s<>]+/gi,
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

                                    return makeProxyUrl(
                                        url,
                                        req
                                    );

                                } catch {

                                    return url;
                                }
                            }
                        );


                        /*
                         * ------------------------------------------------
                         * //domain/path
                         * ------------------------------------------------
                         */

                        html = html.replace(
                            /(["'(=])\/\/([^"'\s<>]+)(\/[^"'\s<>]*)/gi,
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
                                    makeProxyUrl(
                                        original,
                                        req
                                    )
                                );
                            }
                        );


                        /*
                         * ------------------------------------------------
                         * HTML 中的 src / href
                         *
                         * 处理相对资源：
                         *
                         * /images/test.png
                         * ./image.png
                         * ../image.png
                         * ------------------------------------------------
                         */

                        const baseUrl =
                            new URL(
                                req.originalUrl.split("?")[0] || "/",
                                TARGET
                            );


                        html = html.replace(
                            /(src|href|poster|action)\s*=\s*(["'])(.*?)\2/gi,
                            (
                                match,
                                attribute,
                                quote,
                                value
                            ) => {

                                const trimmed =
                                    value.trim();

                                if (
                                    trimmed.startsWith(
                                        "#"
                                    ) ||
                                    trimmed.startsWith(
                                        "data:"
                                    ) ||
                                    trimmed.startsWith(
                                        "javascript:"
                                    ) ||
                                    trimmed.startsWith(
                                        "mailto:"
                                    ) ||
                                    trimmed.startsWith(
                                        "tel:"
                                    )
                                ) {
                                    return match;
                                }

                                /*
                                 * 已经是 proxy URL
                                 */
                                if (
                                    trimmed.startsWith(
                                        "/__resource"
                                    )
                                ) {
                                    return match;
                                }

                                try {

                                    const absolute =
                                        new URL(
                                            trimmed,
                                            baseUrl
                                        ).href;

                                    if (
                                        !/^https?:/i.test(
                                            absolute
                                        )
                                    ) {
                                        return match;
                                    }

                                    const parsed =
                                        new URL(
                                            absolute
                                        );

                                    if (
                                        !isAllowedHost(
                                            parsed.hostname
                                        )
                                    ) {
                                        return match;
                                    }

                                    return (
                                        attribute +
                                        "=" +
                                        quote +
                                        makeProxyUrl(
                                            absolute,
                                            req
                                        ) +
                                        quote
                                    );

                                } catch {

                                    return match;
                                }
                            }
                        );


                        /*
                         * ------------------------------------------------
                         * srcset
                         * ------------------------------------------------
                         */

                        html = html.replace(
                            /(srcset)\s*=\s*(["'])(.*?)\2/gi,
                            (
                                match,
                                attribute,
                                quote,
                                value
                            ) => {

                                const items =
                                    value.split(",");

                                const rewritten =
                                    items.map(item => {

                                        const parts =
                                            item
                                                .trim()
                                                .split(/\s+/);

                                        if (
                                            !parts[0]
                                        ) {
                                            return item;
                                        }

                                        try {

                                            const absolute =
                                                new URL(
                                                    parts[0],
                                                    baseUrl
                                                ).href;

                                            const parsed =
                                                new URL(
                                                    absolute
                                                );

                                            if (
                                                !isAllowedHost(
                                                    parsed.hostname
                                                )
                                            ) {
                                                return item;
                                            }

                                            parts[0] =
                                                makeProxyUrl(
                                                    absolute,
                                                    req
                                                );

                                            return parts.join(
                                                " "
                                            );

                                        } catch {

                                            return item;
                                        }

                                    });

                                return (
                                    attribute +
                                    "=" +
                                    quote +
                                    rewritten.join(
                                        ", "
                                    ) +
                                    quote
                                );
                            }
                        );


                        /*
                         * ------------------------------------------------
                         * inline CSS
                         *
                         * url(...)
                         * ------------------------------------------------
                         */

                        html = rewriteCssUrls(
                            html,
                            baseUrl,
                            req
                        );


                        /*
                         * 禁止浏览器继续使用原来的压缩内容
                         */

                        delete proxyRes.headers[
                            "content-encoding"
                        ];


                        return Buffer.from(
                            html,
                            "utf8"
                        );
                    }


                    /*
                     * 图片 / SVG / JS / CSS 等
                     * 不修改，直接返回
                     */

                    return responseBuffer;
                }
            )
        }
    })
);


/*
 * ==========================================================
 * CSS url(...) 重写
 * ==========================================================
 */

function rewriteCssUrls(
    text,
    baseUrl,
    req
) {

    return text.replace(
        /url\(\s*(["']?)(.*?)\1\s*\)/gi,
        (
            match,
            quote,
            value
        ) => {

            const trimmed =
                value.trim();

            if (
                trimmed.startsWith("data:") ||
                trimmed.startsWith("#")
            ) {
                return match;
            }

            try {

                const absolute =
                    new URL(
                        trimmed,
                        baseUrl
                    ).href;

                const parsed =
                    new URL(
                        absolute
                    );

                if (
                    !isAllowedHost(
                        parsed.hostname
                    )
                ) {
                    return match;
                }

                return (
                    `url("${makeProxyUrl(
                        absolute,
                        req
                    )}")`
                );

            } catch {

                return match;
            }
        }
    );
}


/*
 * ==========================================================
 * Start
 * ==========================================================
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
