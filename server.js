const express = require("express");
const {
    createProxyMiddleware,
    responseInterceptor
} = require("http-proxy-middleware");

const app = express();


/*
==========================================================
TARGET
==========================================================

你以后只需要改这一行。

例如：

const TARGET = "https://live.warthunder.com";

或者：

const TARGET = "https://1939.giaory.xyz";

==========================================================
*/

const TARGET = "https://1939.giaory.xyz";


/*
==========================================================
PORT
==========================================================
*/

const PORT = process.env.PORT || 10000;


/*
==========================================================
TARGET HOST
==========================================================
*/

const TARGET_HOST =
    new URL(TARGET).hostname.toLowerCase();


/*
==========================================================
允许 Proxy 的资源域名
==========================================================

允许：

TARGET 本身
TARGET 子域名
*.warthunder.com
*.encyclopedia.warthunder.com
cdn-live.warthunder.com
==========================================================
*/

function isAllowedHost(hostname) {

    hostname =
        hostname.toLowerCase();


    /*
    TARGET 本身
    */

    if (
        hostname === TARGET_HOST
    ) {
        return true;
    }


    /*
    TARGET 子域名
    */

    if (
        hostname.endsWith(
            "." + TARGET_HOST
        )
    ) {
        return true;
    }


    /*
    War Thunder
    */

    if (
        hostname === "warthunder.com" ||
        hostname.endsWith(
            ".warthunder.com"
        )
    ) {
        return true;
    }


    /*
    Encyclopedia
    */

    if (
        hostname ===
            "encyclopedia.warthunder.com" ||

        hostname.endsWith(
            ".encyclopedia.warthunder.com"
        )
    ) {
        return true;
    }


    return false;
}


/*
==========================================================
生成 /__resource URL
==========================================================
*/

function makeProxyUrl(
    originalUrl,
    req
) {

    const protocol =
        req.headers[
            "x-forwarded-proto"
        ] || "https";


    const host =
        req.headers.host;


    return (
        `${protocol}://${host}` +
        `/__resource?url=` +
        encodeURIComponent(
            originalUrl
        )
    );
}


/*
==========================================================
把 URL 转换成 Proxy URL
==========================================================
*/

function rewriteUrl(
    url,
    req
) {

    try {

        /*
        如果已经是我们的 Proxy
        不要重复处理
        */

        if (
            url.includes(
                "/__resource?"
            )
        ) {
            return url;
        }


        const parsed =
            new URL(url);


        /*
        只处理允许的域名
        */

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


/*
==========================================================
重写普通文本中的 URL
==========================================================

处理：

https://cdn-live.warthunder.com/xxx.png

https://avatars.warthunder.com/xxx.png

https://static.encyclopedia.warthunder.com/xxx.svg

以及 JS 中：

https:\/\/cdn-live.warthunder.com\/xxx.png

==========================================================
*/

function rewriteTextUrls(
    text,
    req
) {

    /*
    ------------------------------------------------------
    普通 URL
    ------------------------------------------------------
    */

    text =
        text.replace(
            /https?:\/\/[^"'<>\\\s)]+/gi,
            (url) => {

                return rewriteUrl(
                    url,
                    req
                );
            }
        );


    /*
    ------------------------------------------------------
    JS escaped URL

    https:\/\/cdn-live...
    ------------------------------------------------------
    */

    text =
        text.replace(
            /https?:\\\/\\\/[^"'<>\\\s)]+/gi,
            (url) => {

                try {

                    /*
                    还原 JS escape
                    */

                    const normalUrl =
                        url.replace(
                            /\\\//g,
                            "/"
                        );


                    const rewritten =
                        rewriteUrl(
                            normalUrl,
                            req
                        );


                    /*
                    如果没有被修改
                    */

                    if (
                        rewritten ===
                        normalUrl
                    ) {
                        return url;
                    }


                    /*
                    再转回 JS escaped 格式
                    */

                    return rewritten.replace(
                        /\//g,
                        "\\/"
                    );

                } catch {

                    return url;
                }
            }
        );


    return text;
}


/*
==========================================================
重写 CSS url(...)
==========================================================
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
            不处理 data:
            */

            if (
                trimmed.startsWith(
                    "data:"
                )
            ) {
                return match;
            }


            /*
            不处理 #
            */

            if (
                trimmed.startsWith(
                    "#"
                )
            ) {
                return match;
            }


            /*
            已经 Proxy
            */

            if (
                trimmed.includes(
                    "/__resource?"
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


                const rewritten =
                    rewriteUrl(
                        absolute,
                        req
                    );


                if (
                    rewritten ===
                    absolute
                ) {
                    return match;
                }


                return (
                    `url("${rewritten}")`
                );

            } catch {

                return match;
            }
        }
    );
}


/*
==========================================================
资源代理

浏览器请求：

/__resource?url=https://cdn-live...
==========================================================
*/

app.get(
    "/__resource",
    async (
        req,
        res
    ) => {

        try {

            const targetUrl =
                req.query.url;


            if (
                !targetUrl ||
                typeof targetUrl !==
                    "string"
            ) {

                return res
                    .status(400)
                    .send(
                        "Missing URL"
                    );
            }


            let parsed;


            try {

                parsed =
                    new URL(
                        targetUrl
                    );

            } catch {

                return res
                    .status(400)
                    .send(
                        "Invalid URL"
                    );
            }


            /*
            只允许 HTTP / HTTPS
            */

            if (
                parsed.protocol !==
                    "http:" &&
                parsed.protocol !==
                    "https:"
            ) {

                return res
                    .status(403)
                    .send(
                        "Protocol not allowed"
                    );
            }


            /*
            域名检查
            */

            if (
                !isAllowedHost(
                    parsed.hostname
                )
            ) {

                return res
                    .status(403)
                    .send(
                        "Domain not allowed"
                    );
            }


            console.log(
                "Loading resource:",
                parsed.href
            );


            /*
            请求 CDN
            */

            const response =
                await fetch(
                    parsed.href,
                    {
                        method: "GET",

                        redirect: "follow",

                        headers: {

                            "User-Agent":
                                req.headers[
                                    "user-agent"
                                ] ||
                                "Mozilla/5.0",

                            "Accept":
                                req.headers[
                                    "accept"
                                ] ||
                                "*/*",

                            "Accept-Language":
                                req.headers[
                                    "accept-language"
                                ] ||
                                "en-US,en;q=0.9",

                            "Referer":
                                TARGET +
                                "/"
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
            请求失败
            */

            if (
                !response.ok
            ) {

                return res
                    .status(
                        response.status
                    )
                    .send(
                        `Resource returned ${response.status}`
                    );
            }


            /*
            Content-Type
            */

            const resourceType =
                response.headers.get(
                    "content-type"
                );


            if (
                resourceType
            ) {

                res.setHeader(
                    "Content-Type",
                    resourceType
                );
            }


            /*
            Content-Length
            */

            const contentLength =
                response.headers.get(
                    "content-length"
                );


            if (
                contentLength
            ) {

                res.setHeader(
                    "Content-Length",
                    contentLength
                );
            }


            /*
            缓存
            */

            res.setHeader(
                "Cache-Control",
                "public, max-age=3600"
            );


            /*
            获取二进制
            */

            const buffer =
                Buffer.from(
                    await response.arrayBuffer()
                );


            res.send(
                buffer
            );

        } catch (error) {

            console.error(
                "Resource error:",
                error
            );


            if (
                !res.headersSent
            ) {

                res
                    .status(500)
                    .send(
                        "Resource error"
                    );
            }
        }
    }
);


/*
==========================================================
主 Proxy
==========================================================
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
            ==================================================
            不使用 proxyReq

            不再手动 setHeader，
            避免：

            ERR_HTTP_HEADERS_SENT
            ==================================================
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
                            (
                                proxyRes
                                    .headers[
                                        "content-type"
                                    ] ||
                                ""
                            ).toLowerCase();


                        /*
                        ==================================================
                        判断是否为文本内容
                        ==================================================
                        */

                        const isHtml =
                            contentType.includes(
                                "text/html"
                            );

                        const isJavaScript =
                            contentType.includes(
                                "javascript"
                            ) ||
                            contentType.includes(
                                "ecmascript"
                            );

                        const isJson =
                            contentType.includes(
                                "application/json"
                            ) ||
                            contentType.includes(
                                "text/json"
                            );

                        const isCss =
                            contentType.includes(
                                "text/css"
                            );

                        const isSvg =
                            contentType.includes(
                                "image/svg+xml"
                            );


                        /*
                        ==================================================
                        HTML / JS / JSON / CSS / SVG
                        ==================================================
                        */

                        if (
                            isHtml ||
                            isJavaScript ||
                            isJson ||
                            isCss ||
                            isSvg
                        ) {

                            let text;


                            try {

                                text =
                                    responseBuffer.toString(
                                        "utf8"
                                    );

                            } catch {

                                return responseBuffer;
                            }


                            /*
                            ==================================================
                            当前页面 URL
                            ==================================================
                            */

                            let baseUrl;


                            try {

                                baseUrl =
                                    new URL(
                                        req.originalUrl ||
                                        "/",
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
                            ==================================================
                            ① HTML / JS / JSON 中的绝对 URL

                            这是最重要的部分。
                            ==================================================
                            */

                            text =
                                rewriteTextUrls(
                                    text,
                                    req
                                );


                            /*
                            ==================================================
                            ② HTML src / href / poster / action
                            ==================================================
                            */

                            if (
                                isHtml
                            ) {

                                text =
                                    text.replace(
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
                                            特殊 URL
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
                                            已经 Proxy
                                            */

                                            if (
                                                trimmed.includes(
                                                    "/__resource?"
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


                                                const rewritten =
                                                    rewriteUrl(
                                                        absolute,
                                                        req
                                                    );


                                                if (
                                                    rewritten ===
                                                    absolute
                                                ) {

                                                    return match;
                                                }


                                                return (
                                                    attribute +
                                                    "=" +
                                                    quote +
                                                    rewritten +
                                                    quote
                                                );

                                            } catch {

                                                return match;
                                            }
                                        }
                                    );


                                /*
                                ==================================================
                                ③ srcset
                                ==================================================
                                */

                                text =
                                    text.replace(
                                        /(srcset)\s*=\s*(["'])(.*?)\2/gi,
                                        (
                                            match,
                                            attribute,
                                            quote,
                                            value
                                        ) => {

                                            const items =
                                                value.split(
                                                    ","
                                                );


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


                                                            const rewrittenUrl =
                                                                rewriteUrl(
                                                                    absolute,
                                                                    req
                                                                );


                                                            if (
                                                                rewrittenUrl ===
                                                                absolute
                                                            ) {

                                                                return item;
                                                            }


                                                            parts[0] =
                                                                rewrittenUrl;


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
                                ==================================================
                                ④ inline CSS
                                ==================================================
                                */

                                text =
                                    rewriteCssUrls(
                                        text,
                                        baseUrl,
                                        req
                                    );
                            }


                            /*
                            ==================================================
                            ⑤ CSS
                            ==================================================
                            */

                            if (
                                isCss
                            ) {

                                text =
                                    rewriteCssUrls(
                                        text,
                                        baseUrl,
                                        req
                                    );
                            }


                            /*
                            ==================================================
                            删除压缩标记

                            因为内容已经修改
                            ==================================================
                            */

                            delete proxyRes
                                .headers[
                                    "content-encoding"
                                ];


                            delete proxyRes
                                .headers[
                                    "content-length"
                                ];


                            /*
                            返回修改后的文本
                            */

                            return Buffer.from(
                                text,
                                "utf8"
                            );
                        }


                        /*
                        ==================================================
                        图片 / 字体 / 视频 / 其它二进制资源

                        不修改
                        ==================================================
                        */

                        return responseBuffer;
                    }
                )
        }
    })
);


/*
==========================================================
启动
==========================================================
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "Proxy running on port " +
            PORT
        );

        console.log(
            "Target: " +
            TARGET
        );

        console.log(
            "Port: " +
            PORT
        );
    }
);
