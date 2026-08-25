const express = require("express");
const {
    createProxyMiddleware,
    responseInterceptor
} = require("http-proxy-middleware");

const app = express();

/*
 * ==========================================================
 * 你只需要改这里
 * ==========================================================
 */

const TARGET = "https://live.warthunder.com/";

const PORT = process.env.PORT || 10000;


/*
 * ==========================================================
 * 允许的资源域名
 * ==========================================================
 */

function isAllowedHost(hostname) {

    hostname = hostname.toLowerCase();

    /*
     * TARGET 本身
     */

    let targetHost;

    try {
        targetHost = new URL(TARGET).hostname.toLowerCase();
    } catch {
        targetHost = "";
    }

    if (
        hostname === targetHost ||
        hostname.endsWith("." + targetHost)
    ) {
        return true;
    }


    /*
     * War Thunder 相关 CDN / 图片 / Encyclopedia
     */

    if (
        hostname === "warthunder.com" ||
        hostname.endsWith(".warthunder.com")
    ) {
        return true;
    }


    if (
        hostname === "encyclopedia.warthunder.com" ||
        hostname.endsWith(".encyclopedia.warthunder.com")
    ) {
        return true;
    }


    /*
     * 常见 War Thunder CDN
     */

    if (
        hostname === "cdn-live.warthunder.com"
    ) {
        return true;
    }


    return false;
}


/*
 * ==========================================================
 * 把外部资源 URL 转换成 Proxy URL
 * ==========================================================
 */

function makeProxyUrl(url, req) {

    const protocol =
        req.headers["x-forwarded-proto"] || "https";

    const host =
        req.headers.host;

    return (
        `${protocol}://${host}/__resource?url=` +
        encodeURIComponent(url)
    );
}


/*
 * ==========================================================
 * Health Check
 * ==========================================================
 */

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});


/*
 * ==========================================================
 * 外部资源 Proxy
 *
 * 例如：
 *
 * /__resource?url=https://cdn-live.warthunder.com/xxx.png
 *
 * ==========================================================
 */

app.get("/__resource", async (req, res) => {

    try {

        const target =
            req.query.url;

        if (!target) {
            return res
                .status(400)
                .send("Missing URL");
        }


        const url =
            new URL(target);


        /*
         * 检查域名
         */

        if (!isAllowedHost(url.hostname)) {

            return res
                .status(403)
                .send("Domain not allowed");
        }


        console.log(
            "Loading resource:",
            url.href
        );


        /*
         * 请求资源
         */

        const response =
            await fetch(
                url.href,
                {
                    method: "GET",

                    redirect: "follow",

                    headers: {

                        "User-Agent":
                            req.headers["user-agent"] ||
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",

                        "Accept":
                            req.headers["accept"] ||
                            "*/*",

                        "Accept-Language":
                            req.headers["accept-language"] ||
                            "en-US,en;q=0.9",

                        "Referer":
                            TARGET.endsWith("/")
                                ? TARGET
                                : TARGET + "/"
                    }
                }
            );


        console.log(
            "Resource response:",
            response.status,
            response.headers.get(
                "content-type"
            )
        );


        /*
         * CDN 返回错误
         */

        if (!response.ok) {

            return res
                .status(response.status)
                .send(
                    `Resource returned ${response.status}`
                );
        }


        /*
         * Content-Type
         */

        const contentType =
            response.headers.get(
                "content-type"
            );

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
         * 返回二进制内容
         */

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


        if (!res.headersSent) {

            res
                .status(500)
                .send("Resource error");
        }
    }
});


/*
 * ==========================================================
 * 主网站 Proxy
 * ==========================================================
 *
 * 例如：
 *
 * Render/
 *       ↓
 * TARGET/
 *
 * Render/collection
 *       ↓
 * TARGET/collection
 *
 * Render/cards/123
 *       ↓
 * TARGET/cards/123
 *
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

            /*
             * ======================================================
             * 发给 TARGET 的请求
             * ======================================================
             */

            proxyReq(proxyReq) {

                if (proxyReq.destroyed) {
                    return;
                }


                try {

                    proxyReq.setHeader(
                        "Referer",
                        TARGET.endsWith("/")
                            ? TARGET
                            : TARGET + "/"
                    );


                    proxyReq.setHeader(
                        "Origin",
                        TARGET
                    );


                    proxyReq.setHeader(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36"
                    );

                } catch (error) {

                    console.error(
                        "proxyReq header error:",
                        error.message
                    );
                }
            },


            /*
             * ======================================================
             * TARGET 返回
             * ======================================================
             */

            proxyRes:
                responseInterceptor(
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
                         * ==================================================
                         * HTML
                         * ==================================================
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


                            /*
                             * 当前 Proxy URL
                             */

                            const protocol =
                                req.headers[
                                    "x-forwarded-proto"
                                ] || "https";


                            const host =
                                req.headers.host;


                            /*
                             * ==================================================
                             * 绝对 URL
                             *
                             * https://cdn-live.warthunder.com/xxx.png
                             * ==================================================
                             */

                            html =
                                html.replace(
                                    /https?:\/\/[^"'\s<>]+/gi,
                                    (url) => {

                                        try {

                                            const parsed =
                                                new URL(
                                                    url
                                                );


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
                             * ==================================================
                             * //domain/path
                             *
                             * //cdn-live.warthunder.com/image.png
                             * ==================================================
                             */

                            html =
                                html.replace(
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
                             * ==================================================
                             * 页面当前 URL
                             *
                             * 例如：
                             *
                             * /collection
                             *
                             * 就以 TARGET/collection 作为相对路径基础
                             * ==================================================
                             */

                            const requestPath =
                                req.originalUrl ||
                                "/";


                            let baseUrl;


                            try {

                                baseUrl =
                                    new URL(
                                        requestPath,
                                        TARGET
                                    );

                            } catch {

                                baseUrl =
                                    new URL(
                                        "/",
                                        TARGET
                                    );
                            }


                            /*
                             * ==================================================
                             * src / href / poster / action
                             *
                             * 处理：
                             *
                             * /image.png
                             * ./image.png
                             * ../image.png
                             * https://...
                             * ==================================================
                             */

                            html =
                                html.replace(
                                    /(src|href|poster|action)\s*=\s*(["'])(.*?)\2/gi,
                                    (
                                        match,
                                        attribute,
                                        quote,
                                        value
                                    ) => {

                                        const trimmed =
                                            value.trim();


                                        /*
                                         * 不处理这些
                                         */

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
                                         * 已经是 Proxy
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
                             * ==================================================
                             * srcset
                             * ==================================================
                             */

                            html =
                                html.replace(
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
                                            items.map(
                                                item => {

                                                    const parts =
                                                        item
                                                            .trim()
                                                            .split(
                                                                /\s+/
                                                            );


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
                                                }
                                            );


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
                             * ==================================================
                             * inline CSS
                             *
                             * background-image: url(...)
                             * ==================================================
                             */

                            html =
                                rewriteCssUrls(
                                    html,
                                    baseUrl,
                                    req
                                );


                            /*
                             * 我们已经重新生成 HTML
                             * 删除压缩标记
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
                         * ==================================================
                         * 图片 / SVG / CSS / JS / 字体等
                         *
                         * 原样返回
                         * ==================================================
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


            /*
             * 不处理 data URL
             */

            if (
                trimmed.startsWith(
                    "data:"
                ) ||

                trimmed.startsWith(
                    "#"
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
 * Start Server
 * ==========================================================
 */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Proxy running on port ${PORT}`
        );

        console.log(
            `Target: ${TARGET}`
        );

        console.log(
            `Port: ${PORT}`
        );
    }
);
