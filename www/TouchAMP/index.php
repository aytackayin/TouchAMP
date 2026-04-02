<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TouchAMP — Documentation</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        :root {
            --bg-color: #0d1117;
            --container-bg: #161b22;
            --text-main: #c9d1d9;
            --text-heading: #f0f6fc;
            --accent: #58a6ff;
            --border: #30363d;
        }

        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            margin: 0;
            padding: 0;
            line-height: 1.6;
        }

        .header {
            position: fixed;
            top: 0;
            right: 0;
            left: 0;
            height: 60px;
            background: rgba(13, 17, 23, 0.8);
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding: 0 40px;
            z-index: 1000;
            border-bottom: 1px solid var(--border);
        }

        .lang-switch {
            display: flex;
            gap: 10px;
        }

        .lang-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 5px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
        }

        .lang-btn.active {
            background: var(--accent);
            color: #fff;
            border-color: var(--accent);
        }

        .lang-btn:hover:not(.active) {
            border-color: var(--accent);
            color: var(--accent);
        }

        .container {
            max-width: 900px;
            margin: 100px auto 100px;
            padding: 40px;
            background: var(--container-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        #content {
            overflow-wrap: break-word;
        }

        #content h1, #content h2, #content h3 {
            color: var(--text-heading);
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            border-bottom: 1px solid var(--border);
            padding-bottom: 0.3em;
        }

        #content a {
            color: var(--accent);
            text-decoration: none;
        }

        #content a:hover {
            text-decoration: underline;
        }

        #content code {
            background: #21262d;
            padding: 0.2em 0.4em;
            border-radius: 6px;
            font-family: 'Courier New', Courier, monospace;
        }

        #content pre {
            background: #21262d;
            padding: 16px;
            border-radius: 12px;
            overflow: auto;
            border: 1px solid var(--border);
        }

        #content blockquote {
            padding: 0 1em;
            color: #8b949e;
            border-left: 0.25em solid var(--border);
            margin: 0;
        }

        #content img {
            max-width: 100%;
            border-radius: 8px;
        }
    </style>
</head>
<body>

<div class="header">
    <div class="lang-switch">
        <button onclick="setLang('en')" id="btn-en" class="lang-btn">English</button>
        <button onclick="setLang('tr')" id="btn-tr" class="lang-btn">Türkçe</button>
    </div>
</div>

<div class="container">
    <div id="content">Loading documentation...</div>
</div>

<script>
    let currentLang = localStorage.getItem('doc_lang') || 'en';

    async function setLang(lang) {
        currentLang = lang;
        localStorage.setItem('doc_lang', lang);
        
        // Update Buttons
        document.getElementById('btn-en').classList.toggle('active', lang === 'en');
        document.getElementById('btn-tr').classList.toggle('active', lang === 'tr');

        try {
            const response = await fetch(`${lang}.md`);
            if (!response.ok) throw new Error('File not found');
            const markdown = await response.text();
            document.getElementById('content').innerHTML = marked.parse(markdown);
            
            // Adjust page title
            const firstHeader = document.querySelector('#content h1');
            if (firstHeader) document.title = firstHeader.innerText + ' — Documentation';
        } catch (err) {
            document.getElementById('content').innerHTML = `<h1>Error</h1><p>Documentation could not be loaded: ${err.message}</p>`;
        }
    }

    // Initial Load
    setLang(currentLang);
</script>

</body>
</html>
