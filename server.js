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
只需要改这里。

例如：

const TARGET = "https://1939.giaory.xyz";

或者：

const TARGET = "https://live.warthunder.com";
*/

const TARGET = "https://live.warthunder.com/";


/*
==========================================================
PORT
==========================================================
*/

const PORT = process.env.PORT || 10000;


/*
==========================================================
允许访问的资源域名
==========================================================
*/

function isAllowedHost(hostname) {

    hostname = hostname.toLowerCase();

    let targetHost = "";

    try {
        targetHost =
            new URL(TARGET).hostname.toLowerCase();
    } catch {
        targetHost = "";
    }


    /*
    TARGET 本身以及它的子域名
    */

    if (
        hostname === targetHost ||
        hostname.endsWith("." + targetHost)
    ) {
        return true;
    }


    /*
    War Thunder 所有子域名
    */

    if (
        hostname === "warthunder.com" ||
        hostname.endsWith(".warthunder.com")
    ) {
        return true;
    }


    /*
    Encyclopedia
    */

    if (
        hostname === "encyclopedia.warthunder.com" ||
        hostname.endsWith(
            ".encyclopedia.warthunder.com"
        )
    ) {
        return true;
    }


    /*
    CDN
    */

    if (
        hostname === "cdn-live.warthunder.com"
    ) {
        return true;
    }


    return false;
}


/*
==========================================================
生成资源 Proxy URL
==========================================================
*/

function makeProxyUrl(url, req) {

    const protocol =
        req.headers["x-forwarded-proto"] ||
        "https";

    const host =
        req.headers.host;

    return (
        `${protocol}://${host}/__resource?url=` +
        encodeURIComponent(url)
    );
}


/*
==========================================================
Health Check
==========================================================
*/

app.get("/health", (req, res) => {

    res
        .status(200)
        .send("OK");
});


/*
==========================================================
资源代理
==========================================================

例如：

/__resource?url=https://cdn-live.warthunder.com/xxx.png

==========================================================
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
        检查域名
        */

        if (
            !isAllowedHost(
                url.hostname
            )
        ) {

            return res
                .status(403)
                .send("Domain not allowed");
        }


        console.log(
            "Loading resource:",
            url.href
        );


        /*
        请求资源
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
        如果资源请求失败
        */

        if (!response.ok) {

            return res
                .status(response.status)
                .send(
                    `Resource returned ${response.status}`
                );
        }


        /*
        Content-Type
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
        缓存
        */

        res.setHeader(
            "Cache-Control",
            "public, max-age=3600"
        );


        /*
        返回二进制内容
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
                .send(
                    "Resource error"
                );
        }
    }
});


/*
==========================================================
主网站 Proxy
==========================================================

/
    ↓
TARGET/

 /collection
    ↓
TARGET/collection

 /cards
    ↓
TARGET/cards

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
            不再修改 proxyReq headers

            之前这里的 setHeader 会导致：

            ERR_HTTP_HEADERS_SENT

            所以这里故意不放 proxyReq。
            ==================================================
            */


            /*
            ==================================================
            TARGET 返回
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
                            proxyRes.headers[
                                "content-type"
                            ] || "";


                        /*
                        ==================================================
                        HTML
                        ==================================================
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
                            ① 强制重写 cdn-live.warthunder.com

                            例如：

                            https://cdn-live.warthunder.com/abc.png

                            →

                            /__resource?url=https%3A%2F%2Fcdn-live...
                            ==================================================
                            */

                            html =
                                html.replace(
                                    /https?:\/\/cdn-live\.warthunder\.com\/[^\s"'<>\\)]+/gi,
                                    (url) => {

                                        try {

                                            /*
                                            去掉可能粘上的标点
                                            */

                                            const cleanUrl =
                                                url.replace(
                                                    /[),;]+$/,
                                                    ""
                                                );


                                            return makeProxyUrl(
                                                cleanUrl,
                                                req
                                            );

                                        } catch {

                                            return url;
                                        }
                                    }
                                );


                            /*
                            ==================================================
                            ② 重写所有允许域名的绝对 URL

                            https://avatars.warthunder.com/...
                            https://static.encyclopedia.warthunder.com/...
                            ==================================================
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


                                            /*
                                            已经被转换成
                                            /__resource
                                            的不要再次处理
                                            */

                                            if (
                                                url.includes(
                                                    "/__resource?"
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
                            ==================================================
                            ③ //domain/path

                            例如：

                            //cdn-live.warthunder.com/xxx.png
                            ==================================================
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
                            ==================================================
                            ④ src / href / poster / action

                            处理：

                            /image.png
                            ./image.png
                            ../image.png
                            https://...
                            ==================================================
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
                                        不处理特殊 URL
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
                                        已经是 Proxy
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
                            ==================================================
                            ⑤ srcset

                            例如：

                            image1.jpg 1x,
                            image2.jpg 2x
                            ==================================================
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
                            ==================================================
                            ⑥ CSS url(...)

                            background-image:
                            url(...)
                            ==================================================
                            */

                            html =
                                rewriteCssUrls(
                                    html,
                                    baseUrl,
                                    req
                                );


                            /*
                            ==================================================
                            删除压缩标记

                            因为 HTML 已经被修改
                            ==================================================
                            */

                            delete proxyRes.headers[
                                "content-encoding"
                            ];


                            /*
                            返回修改后的 HTML
                            */

                            return Buffer.from(
                                html,
                                "utf8"
                            );
                        }


                        /*
                        ==================================================
                        图片 / SVG / CSS / JS / 字体等

                        非 HTML 不修改
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
CSS URL 重写
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
            data:image...
            */

            if (
                trimmed.startsWith(
                    "data:"
                )
            ) {

                return match;
            }


            /*
            #something
            */

            if (
                trimmed.startsWith(
                    "#"
                )
            ) {

                return match;
            }


            /*
            已经是 Proxy
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
==========================================================
启动服务器
==========================================================
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
