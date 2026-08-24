const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT = 30000;


/*
==================================================
安全检查
==================================================
*/

function isPrivateHostname(hostname) {
    const host = hostname.toLowerCase();

    return (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "0.0.0.0" ||
        host === "metadata.google.internal" ||
        host === "metadata.google.com"
    );
}


function isAllowedUrl(value) {

    let url;

    try {
        url = new URL(value);
    } catch {
        return false;
    }

    if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
    ) {
        return false;
    }

    if (isPrivateHostname(url.hostname)) {
        return false;
    }

    return true;
}


/*
==================================================
把用户输入变成 URL
==================================================
*/

function normalizeUrl(value) {

    value = value.trim();

    if (!value) {
        throw new Error("Empty URL");
    }

    if (!/^https?:\/\//i.test(value)) {
        value = "https://" + value;
    }

    const url = new URL(value);

    if (!isAllowedUrl(url.href)) {
        throw new Error("URL not allowed");
    }

    return url.href;
}


/*
==================================================
安全 Fetch
==================================================
*/

async function fetchTarget(startUrl) {

    let currentUrl = startUrl;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {

        if (!isAllowedUrl(currentUrl)) {
            throw new Error("Redirect target not allowed");
        }

        const controller = new AbortController();

        const timeout = setTimeout(
            () => controller.abort(),
            FETCH_TIMEOUT
        );

        let response;

        try {

            response = await fetch(currentUrl, {
                redirect: "manual",

                signal: controller.signal,

                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",

                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",

                    "Accept-Language":
                        "en-US,en;q=0.9"
                }
            });

        } finally {

            clearTimeout(timeout);

        }


        /*
        处理 Redirect
        */

        if (
            response.status >= 300 &&
            response.status < 400
        ) {

            const location =
                response.headers.get("location");

            if (!location) {
                return {
                    response,
                    finalUrl: currentUrl
                };
            }

            const nextUrl =
                new URL(
                    location,
                    currentUrl
                ).href;

            currentUrl = nextUrl;

            continue;
        }


        return {
            response,
            finalUrl: currentUrl
        };
    }

    throw new Error("Too many redirects");
}


/*
==================================================
Proxy URL
==================================================
*/

function proxyUrl(targetUrl, req, mode = "resource") {

    const protocol =
        req.headers["x-forwarded-proto"] || "https";

    const host =
        req.headers.host;

    return (
        `${protocol}://${host}/` +
        `${mode}?url=` +
        encodeURIComponent(targetUrl)
    );
}


/*
==================================================
重写 HTML
==================================================
*/

function rewriteHtml(html, baseUrl, req) {

    const originalBase =
        new URL(baseUrl);


    /*
    href
    src
    action
    poster
    */

    html = html.replace(
        /(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi,

        function(match, attribute, quote, value) {

            const trimmed = value.trim();

            /*
            不处理：
            #anchor
            data:
            javascript:
            mailto:
            tel:
            */

            if (
                trimmed.startsWith("#") ||
                /^(data|javascript|mailto|tel):/i.test(trimmed)
            ) {
                return match;
            }

            try {

                const absolute =
                    new URL(
                        trimmed,
                        originalBase
                    ).href;

                if (!/^https?:/i.test(absolute)) {
                    return match;
                }

                return (
                    `${attribute}=${quote}` +
                    proxyUrl(
                        absolute,
                        req,
                        "view"
                    ) +
                    `${quote}`
                );

            } catch {

                return match;

            }
        }
    );


    /*
    srcset
    */

    html = html.replace(
        /(srcset)\s*=\s*(["'])(.*?)\2/gi,

        function(match, attribute, quote, value) {

            const parts =
                value.split(",");

            const rewritten =
                parts.map(part => {

                    const bits =
                        part.trim().split(/\s+/);

                    if (!bits[0]) {
                        return part;
                    }

                    try {

                        const absolute =
                            new URL(
                                bits[0],
                                originalBase
                            ).href;

                        if (
                            !/^https?:/i.test(
                                absolute
                            )
                        ) {
                            return part;
                        }

                        bits[0] =
                            proxyUrl(
                                absolute,
                                req,
                                "resource"
                            );

                        return bits.join(" ");

                    } catch {

                        return part;

                    }

                }).join(", ");

            return (
                `${attribute}=${quote}` +
                rewritten +
                `${quote}`
            );
        }
    );


    /*
    CSS inline style：

    style="background-image:url(...)"
    */

    html = html.replace(
        /url\(\s*(["']?)(.*?)\1\s*\)/gi,

        function(match, quote, value) {

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
                        originalBase
                    ).href;

                if (
                    !/^https?:/i.test(
                        absolute
                    )
                ) {
                    return match;
                }

                return (
                    `url("${proxyUrl(
                        absolute,
                        req,
                        "resource"
                    )}")`
                );

            } catch {

                return match;

            }
        }
    );


    return html;
}


/*
==================================================
重写 CSS
==================================================
*/

function rewriteCss(css, baseUrl, req) {

    const originalBase =
        new URL(baseUrl);


    css = css.replace(
        /url\(\s*(["']?)(.*?)\1\s*\)/gi,

        function(match, quote, value) {

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
                        originalBase
                    ).href;

                if (
                    !/^https?:/i.test(
                        absolute
                    )
                ) {
                    return match;
                }

                return (
                    `url("${proxyUrl(
                        absolute,
                        req,
                        "resource"
                    )}")`
                );

            } catch {

                return match;

            }
        }
    );


    return css;
}


/*
==================================================
首页
==================================================
*/

app.get("/", (req, res) => {

    res.send(`
<!DOCTYPE html>

<html>

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

    margin-top: 15px;

    color: #ff5555;

    display: none;

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

<form id="form">

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
    document.getElementById("form");

const input =
    document.getElementById("url");

const error =
    document.getElementById("error");


form.addEventListener(
    "submit",
    function(event) {

        event.preventDefault();

        let value =
            input.value.trim();

        if (!value) {
            return;
        }

        if (
            !/^https?:\\/\\//i.test(value)
        ) {
            value =
                "https://" + value;
        }

        try {

            const url =
                new URL(value);

            if (
                url.protocol !== "http:" &&
                url.protocol !== "https:"
            ) {

                throw new Error();

            }

            window.location.href =
                "/view?url=" +
                encodeURIComponent(
                    url.href
                );

        } catch {

            error.textContent =
                "Invalid URL.";

            error.style.display =
                "block";

        }

    }
);

</script>

</body>

</html>
    `);

});


/*
==================================================
Health check
==================================================
*/

app.get("/health", (req, res) => {

    res.status(200).send("OK");

});


/*
==================================================
网页代理
==================================================
*/

app.get("/view", async (req, res) => {

    try {

        const inputUrl =
            normalizeUrl(
                req.query.url || ""
            );


        const {
            response,
            finalUrl
        } =
            await fetchTarget(
                inputUrl
            );


        const contentType =
            response.headers.get(
                "content-type"
            ) || "";


        /*
        HTML
        */

        if (
            contentType.includes(
                "text/html"
            )
        ) {

            let html =
                await response.text();


            html =
                rewriteHtml(
                    html,
                    finalUrl,
                    req
                );


            res.status(
                response.status
            );

            res.setHeader(
                "Content-Type",
                "text/html; charset=utf-8"
            );

            res.setHeader(
                "Cache-Control",
                "no-cache"
            );

            return res.send(html);
        }


        /*
        CSS
        */

        if (
            contentType.includes(
                "text/css"
            )
        ) {

            let css =
                await response.text();


            css =
                rewriteCss(
                    css,
                    finalUrl,
                    req
                );


            res.status(
                response.status
            );

            res.setHeader(
                "Content-Type",
                contentType
            );

            return res.send(css);
        }


        /*
        其他资源
        */

        const buffer =
            Buffer.from(
                await response.arrayBuffer()
            );


        res.status(
            response.status
        );


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


        return res.send(buffer);

    } catch (error) {

        console.error(
            "Proxy error:",
            error
        );


        return res
            .status(500)
            .send(`
                <h1>Proxy Error</h1>
                <pre>${String(
                    error.message
                )}</pre>
            `);

    }

});


/*
==================================================
资源代理
==================================================
*/

app.get("/resource", async (req, res) => {

    try {

        const inputUrl =
            normalizeUrl(
                req.query.url || ""
            );


        const {
            response
        } =
            await fetchTarget(
                inputUrl
            );


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


        res.setHeader(
            "Cache-Control",
            "public, max-age=3600"
        );


        const buffer =
            Buffer.from(
                await response.arrayBuffer()
            );


        return res.send(buffer);

    } catch (error) {

        console.error(
            "Resource error:",
            error
        );


        return res
            .status(500)
            .send("Resource error");

    }

});


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
