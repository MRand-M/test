const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

const PORT = process.env.PORT || 10000;

/*
==================================================
基本安全检查
==================================================
*/

function isValidTarget(value) {
    try {
        const url = new URL(value);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );
    } catch {
        return false;
    }
}


/*
==================================================
把目标 URL 转成当前 Proxy 的 URL
==================================================
*/

function proxyUrl(target, req, type = "asset") {
    const protocol =
        req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    return (
        `${protocol}://${host}/${type}?url=` +
        encodeURIComponent(target)
    );
}


/*
==================================================
首页
==================================================
*/

app.get("/", (req, res) => {

    res.send(`
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>Web Proxy</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;

    display: flex;
    justify-content: center;
    align-items: center;

    background: #111;
    color: white;

    font-family: Arial, sans-serif;
}

.container {
    width: min(700px, 90%);
    text-align: center;
}

h1 {
    font-size: 32px;
    margin-bottom: 30px;
}

.form {
    display: flex;
    gap: 10px;
}

input {
    flex: 1;
    min-width: 0;

    padding: 15px;

    border: 1px solid #444;
    border-radius: 8px;

    background: #222;
    color: white;

    font-size: 16px;
    outline: none;
}

input:focus {
    border-color: #888;
}

button {
    padding: 15px 25px;

    border: none;
    border-radius: 8px;

    background: white;
    color: black;

    font-size: 16px;
    font-weight: bold;

    cursor: pointer;
}

button:hover {
    background: #ddd;
}

#error {
    display: none;

    margin-top: 15px;

    color: #ff5555;
}

.hint {
    margin-top: 20px;

    color: #777;

    font-size: 13px;
}

</style>

</head>

<body>

<div class="container">

<h1>Web Proxy</h1>

<form id="proxyForm">

<div class="form">

<input
    id="url"
    type="text"
    placeholder="https://example.com/"
    autocomplete="off"
>

<button type="submit">
GO
</button>

</div>

</form>

<div id="error"></div>

<div class="hint">
Enter a website URL
</div>

</div>


<script>

const form =
    document.getElementById("proxyForm");

const input =
    document.getElementById("url");

const error =
    document.getElementById("error");


form.addEventListener("submit", function(event) {

    event.preventDefault();

    let value =
        input.value.trim();

    if (!value) {
        return;
    }


    /*
    自动添加 https://
    */

    if (!/^https?:\\/\\//i.test(value)) {
        value = "https://" + value;
    }


    try {

        const url = new URL(value);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            throw new Error();
        }


        window.location.href =
            "/go?url=" +
            encodeURIComponent(url.href);

    } catch {

        error.textContent =
            "Invalid URL.";

        error.style.display =
            "block";
    }

});

</script>

</body>

</html>
    `);

});


/*
==================================================
Health Check
==================================================
*/

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});


/*
==================================================
通用网页 Proxy
==================================================
*/

app.use(
    "/go",
    async (req, res, next) => {

        const target =
            req.query.url;

        if (!target || !isValidTarget(target)) {

            return res
                .status(400)
                .send("Invalid URL");

        }


        let targetUrl;

        try {
            targetUrl = new URL(target);
        } catch {
            return res
                .status(400)
                .send("Invalid URL");
        }


        /*
        把请求交给 http-proxy-middleware
        */

        createProxyMiddleware({

            target: targetUrl.origin,

            changeOrigin: true,

            secure: true,

            followRedirects: true,

            selfHandleResponse: true,


            pathRewrite: () => {

                return (
                    targetUrl.pathname +
                    targetUrl.search
                );

            },


            on: {

                proxyReq(proxyReq) {

                    proxyReq.setHeader(
                        "User-Agent",
                        req.headers["user-agent"] ||
                        "Mozilla/5.0"
                    );

                    proxyReq.setHeader(
                        "Accept-Language",
                        req.headers["accept-language"] ||
                        "en-US,en;q=0.9"
                    );

                    proxyReq.setHeader(
                        "Referer",
                        targetUrl.origin + "/"
                    );

                },


                async proxyRes(
                    proxyRes,
                    req,
                    res
                ) {

                    /*
                    ==========================================
                    删除阻止嵌入的 Header
                    ==========================================
                    */

                    delete proxyRes.headers[
                        "x-frame-options"
                    ];

                    delete proxyRes.headers[
                        "content-security-policy"
                    ];

                    delete proxyRes.headers[
                        "content-security-policy-report-only"
                    ];


                    /*
                    ==========================================
                    Cookie
                    ==========================================
                    */

                    if (
                        proxyRes.headers["set-cookie"]
                    ) {

                        proxyRes.headers["set-cookie"] =
                            proxyRes.headers[
                                "set-cookie"
                            ].map(cookie =>
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
                    ==========================================
                    获取 Content-Type
                    ==========================================
                    */

                    const contentType =
                        proxyRes.headers[
                            "content-type"
                        ] || "";


                    /*
                    ==========================================
                    如果不是 HTML / CSS
                    直接返回原始资源
                    ==========================================
                    */

                    if (
                        !contentType.includes(
                            "text/html"
                        ) &&
                        !contentType.includes(
                            "text/css"
                        )
                    ) {

                        return;

                    }


                    /*
                    ==========================================
                    HTML / CSS 需要修改
                    ==========================================
                    */

                    const chunks = [];

                    proxyRes.on(
                        "data",
                        chunk => {
                            chunks.push(chunk);
                        }
                    );


                    proxyRes.on(
                        "end",
                        () => {

                            let body =
                                Buffer.concat(
                                    chunks
                                ).toString("utf8");


                            /*
                            ==================================
                            HTML
                            ==================================
                            */

                            if (
                                contentType.includes(
                                    "text/html"
                                )
                            ) {

                                body =
                                    rewriteHTML(
                                        body,
                                        targetUrl.href,
                                        req
                                    );

                            }


                            /*
                            ==================================
                            CSS
                            ==================================
                            */

                            else if (
                                contentType.includes(
                                    "text/css"
                                )
                            ) {

                                body =
                                    rewriteCSS(
                                        body,
                                        targetUrl.href,
                                        req
                                    );

                            }


                            /*
                            ==================================
                            删除压缩 Header
                            ==================================
                            */

                            delete res
                                .getHeaders()[
                                    "content-encoding"
                                ];


                            res.setHeader(
                                "Content-Type",
                                contentType
                            );


                            res.send(body);

                        }
                    );

                }

            }

        })(req, res, next);

    }
);


/*
==================================================
资源 Proxy
==================================================
*/

app.get(
    "/asset",
    (req, res) => {

        const target =
            req.query.url;

        if (!target || !isValidTarget(target)) {

            return res
                .status(400)
                .send("Invalid asset URL");

        }


        let targetUrl;

        try {
            targetUrl = new URL(target);
        } catch {
            return res
                .status(400)
                .send("Invalid asset URL");
        }


        createProxyMiddleware({

            target: targetUrl.origin,

            changeOrigin: true,

            secure: true,

            followRedirects: true,

            pathRewrite: () => {

                return (
                    targetUrl.pathname +
                    targetUrl.search
                );

            },


            on: {

                proxyReq(proxyReq) {

                    proxyReq.setHeader(
                        "User-Agent",
                        "Mozilla/5.0"
                    );

                    proxyReq.setHeader(
                        "Referer",
                        targetUrl.origin + "/"
                    );

                },


                proxyRes(proxyRes) {

                    /*
                    删除限制
                    */

                    delete proxyRes.headers[
                        "x-frame-options"
                    ];

                    delete proxyRes.headers[
                        "content-security-policy"
                    ];

                    /*
                    Cookie
                    */

                    if (
                        proxyRes.headers["set-cookie"]
                    ) {

                        proxyRes.headers["set-cookie"] =
                            proxyRes.headers[
                                "set-cookie"
                            ].map(cookie =>
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

                }

            }

        })(req, res);

    }
);


/*
==================================================
HTML URL 重写
==================================================
*/

function rewriteHTML(
    html,
    baseUrl,
    req
) {

    const base =
        new URL(baseUrl);


    /*
    ==============================================
    href
    src
    action
    poster
    ==============================================
    */

    html = html.replace(
        /(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi,

        function(
            match,
            attribute,
            quote,
            value
        ) {

            const original =
                value.trim();


            /*
            不处理特殊 URL
            */

            if (
                original.startsWith("#") ||
                original.startsWith("data:") ||
                original.startsWith("blob:") ||
                original.startsWith("javascript:") ||
                original.startsWith("mailto:") ||
                original.startsWith("tel:")
            ) {

                return match;

            }


            /*
            <base href="">
            */

            if (
                attribute.toLowerCase() === "href" &&
                original.toLowerCase().startsWith(
                    "javascript:"
                )
            ) {
                return match;
            }


            try {

                const absolute =
                    new URL(
                        original,
                        base
                    ).href;


                if (
                    !/^https?:/i.test(
                        absolute
                    )
                ) {

                    return match;

                }


                /*
                链接和页面
                */

                const type =
                    attribute.toLowerCase() ===
                    "href" ||
                    attribute.toLowerCase() ===
                    "action"
                        ? "go"
                        : "asset";


                return (
                    attribute +
                    "=" +
                    quote +
                    proxyUrl(
                        absolute,
                        req,
                        type
                    ) +
                    quote
                );

            } catch {

                return match;

            }

        }
    );


    /*
    ==============================================
    srcset
    ==============================================
    */

    html = html.replace(
        /(srcset)\s*=\s*(["'])(.*?)\2/gi,

        function(
            match,
            attribute,
            quote,
            value
        ) {

            const items =
                value.split(",");


            const result =
                items.map(item => {

                    const parts =
                        item.trim().split(/\s+/);


                    if (!parts[0]) {
                        return item;
                    }


                    try {

                        const absolute =
                            new URL(
                                parts[0],
                                base
                            ).href;


                        if (
                            !/^https?:/i.test(
                                absolute
                            )
                        ) {
                            return item;
                        }


                        parts[0] =
                            proxyUrl(
                                absolute,
                                req,
                                "asset"
                            );


                        return parts.join(" ");

                    } catch {

                        return item;

                    }

                });


            return (
                attribute +
                "=" +
                quote +
                result.join(", ") +
                quote
            );

        }
    );


    /*
    ==============================================
    HTML 中的 style="..."
    ==============================================
    */

    html = html.replace(
        /style\s*=\s*(["'])(.*?)\1/gi,

        function(
            match,
            quote,
            value
        ) {

            return (
                "style=" +
                quote +
                rewriteCSS(
                    value,
                    base.href,
                    req
                ) +
                quote
            );

        }
    );


    /*
    ==============================================
    HTML 里的 url(...)
    ==============================================
    */

    html = rewriteCSS(
        html,
        base.href,
        req
    );


    return html;
}


/*
==================================================
CSS URL 重写
==================================================
*/

function rewriteCSS(
    css,
    baseUrl,
    req
) {

    const base =
        new URL(baseUrl);


    return css.replace(
        /url\(\s*(["']?)(.*?)\1\s*\)/gi,

        function(
            match,
            quote,
            value
        ) {

            const original =
                value.trim();


            if (
                original.startsWith(
                    "data:"
                ) ||
                original.startsWith(
                    "#"
                )
            ) {

                return match;

            }


            try {

                const absolute =
                    new URL(
                        original,
                        base
                    ).href;


                if (
                    !/^https?:/i.test(
                        absolute
                    )
                ) {

                    return match;

                }


                return (
                    'url("' +
                    proxyUrl(
                        absolute,
                        req,
                        "asset"
                    ) +
                    '")'
                );

            } catch {

                return match;

            }

        }
    );
}


/*
==================================================
启动
==================================================
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
