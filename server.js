const express = require("express");
const {
    createProxyMiddleware,
    responseInterceptor
} = require("http-proxy-middleware");

const app = express();

const PORT = process.env.PORT || 10000;

const HOME = "https://wiki.warthunder.com";


/*
==================================================
允许的 War Thunder 域名
==================================================
*/

function isAllowedHost(hostname) {

    if (!hostname) {
        return false;
    }

    hostname = hostname.toLowerCase();

    return (
        hostname === "warthunder.com" ||
        hostname.endsWith(".warthunder.com") ||
        hostname === "encyclopedia.warthunder.com" ||
        hostname.endsWith(".encyclopedia.warthunder.com")
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

<html>

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>War Thunder Proxy</title>

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

    width: min(650px, 90%);

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

    border-radius: 8px;

    border: 1px solid #444;

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

    font-weight: bold;

    font-size: 16px;

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

<h1>War Thunder Web Proxy</h1>


<form id="form">

<div class="form">

<input
    id="url"
    type="text"
    placeholder="https://wiki.warthunder.com/"
    autocomplete="off"
>

<button type="submit">
GO
</button>

</div>

</form>


<div id="error"></div>


<div class="hint">
War Thunder websites only
</div>


</div>


<script>

const form = document.getElementById("form");

const input = document.getElementById("url");

const error = document.getElementById("error");


form.addEventListener("submit", function(e) {

    e.preventDefault();


    let value = input.value.trim();


    if (!value) {
        return;
    }


    /*
    自动补 https://
    */

    if (!/^https?:\\/\\//i.test(value)) {

        value = "https://" + value;

    }


    let url;


    try {

        url = new URL(value);

    } catch {

        error.textContent = "Invalid URL.";

        error.style.display = "block";

        return;

    }


    const host =
        url.hostname.toLowerCase();


    /*
    只允许 War Thunder
    */

    const allowed =
        host === "warthunder.com" ||
        host.endsWith(".warthunder.com") ||
        host === "encyclopedia.warthunder.com" ||
        host.endsWith(".encyclopedia.warthunder.com");


    if (!allowed) {

        error.textContent =
            "Only War Thunder websites are supported.";

        error.style.display = "block";

        return;

    }


    /*
    进入网页 Proxy
    */

    window.location.href =
        "/visit?url=" +
        encodeURIComponent(url.href);

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
访问网页
==================================================
*/

app.use(
    "/visit",
    async (req, res) => {

        try {

            const originalUrl =
                req.query.url;


            if (!originalUrl) {

                return res
                    .status(400)
                    .send("Missing URL");

            }


            const targetUrl =
                new URL(originalUrl);


            if (
                !isAllowedHost(
                    targetUrl.hostname
                )
            ) {

                return res
                    .status(403)
                    .send("Domain not allowed");

            }


            /*
            创建真正的网页 Proxy
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
                            "Referer",
                            "https://wiki.warthunder.com/"
                        );

                    },


                    proxyRes:
                    responseInterceptor(
                        async (
                            buffer,
                            proxyRes,
                            req,
                            res
                        ) => {


                            const type =
                                proxyRes.headers[
                                    "content-type"
                                ] || "";


                            /*
                            HTML 重写
                            */

                            if (
                                type.includes(
                                    "text/html"
                                )
                            ) {

                                let html =
                                    buffer.toString(
                                        "utf8"
                                    );


                                const protocol =
                                    req.headers[
                                        "x-forwarded-proto"
                                    ] || "https";


                                const host =
                                    req.headers.host;


                                const base =
                                    `${protocol}://${host}`;


                                /*
                                绝对 URL
                                */

                                html = html.replace(
                                    /https?:\\/\\/[^"'\\s<>]+/gi,
                                    function(url) {

                                        try {

                                            const u =
                                                new URL(url);


                                            if (
                                                !isAllowedHost(
                                                    u.hostname
                                                )
                                            ) {

                                                return url;

                                            }


                                            return (
                                                base +
                                                "/visit?url=" +
                                                encodeURIComponent(
                                                    u.href
                                                )
                                            );

                                        } catch {

                                            return url;

                                        }

                                    }
                                );


                                /*
                                //domain.com/path
                                */

                                html = html.replace(
                                    /(["'(=])\\/\\/([^"'\\s<>]+\\.[^"'\\s<>]+)(\\/[^"'\\s<>]*)/gi,
                                    function(
                                        match,
                                        prefix,
                                        hostname,
                                        path
                                    ) {


                                        if (
                                            !isAllowedHost(
                                                hostname
                                            )
                                        ) {

                                            return match;

                                        }


                                        const original =
                                            "https://" +
                                            hostname +
                                            path;


                                        return (
                                            prefix +
                                            base +
                                            "/visit?url=" +
                                            encodeURIComponent(
                                                original
                                            )
                                        );

                                    }
                                );


                                /*
                                相对 URL 不需要改。

                                /img/a.png
                                /css/style.css
                                /wiki/Test
                                
                                都会继续请求当前 Proxy。
                                */


                                return Buffer.from(
                                    html,
                                    "utf8"
                                );

                            }


                            return buffer;

                        }
                    )

                }

            })(req, res);

        } catch (error) {

            console.error(
                "Proxy error:",
                error
            );

            res
                .status(500)
                .send("Proxy error");

        }

    }
);


/*
==================================================
Start
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
