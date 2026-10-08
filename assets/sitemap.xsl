<?xml version="1.0" encoding="UTF-8"?>
<!--
  How YunZheng LAB's sitemaps look in a browser. Crawlers ignore this file;
  a person opening any of our sitemaps sees a table instead of raw XML.

  One file for every host: yunzheng.space serves it, and every other host
  serves the same bytes at its own /sitemap.xsl (browsers only apply a
  stylesheet from the sitemap's own origin). Handles both a <urlset> (every
  URL, grouped by host, with language alternates, last change, images and
  videos) and a <sitemapindex> (each child sitemap with its URL count, read
  from the <!- - urls: N - -> comment the index carries).
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
  exclude-result-prefixes="s xhtml image video">
  <xsl:output method="html" encoding="UTF-8" indent="no" doctype-system="about:legacy-compat"/>

  <!-- the host part of a URL: https://host/path -> host -->
  <xsl:template name="host">
    <xsl:param name="u"/>
    <xsl:variable name="rest" select="substring-after($u, '://')"/>
    <xsl:choose>
      <xsl:when test="contains($rest, '/')"><xsl:value-of select="substring-before($rest, '/')"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$rest"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:key name="by-host" match="s:url" use="substring-before(concat(substring-after(s:loc, '://'), '/'), '/')"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <link rel="icon" href="https://yunzheng.space/favicon.ico"/>
        <title>Sitemap · YunZheng LAB</title>
        <style>
          :root { --text: #0a0a0a; --dim: #5b6368; --blue: #006cd2; --line: rgba(10,10,10,.12); --surface: #f4f6f8; }
          * { box-sizing: border-box; }
          body { margin: 0; font: 15px/1.5 "Inter", "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--text); background: #fff; }
          main { max-width: 1240px; margin: 0 auto; padding: 40px 16px 64px; }
          .badge { display: inline-block; font-size: 13px; padding: 6px 12px; border: 1px solid var(--line); }
          h1 { font-size: clamp(28px, 4vw, 44px); letter-spacing: -.03em; margin: 16px 0 8px; }
          h2 { font-size: 20px; margin: 36px 0 8px; letter-spacing: -.01em; }
          p { color: var(--dim); max-width: 760px; margin: 0 0 12px; }
          a { color: var(--blue); text-decoration: none; word-break: break-all; }
          a:hover { text-decoration: underline; }
          .counts { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 8px; padding: 0; list-style: none; }
          .counts li { border: 1px solid var(--line); padding: 6px 10px; font-size: 13px; }
          .counts b { font-weight: 600; }
          table { width: 100%; border-collapse: collapse; font-size: 14px; }
          th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
          thead th { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); border-bottom: 2px solid var(--blue); }
          td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
          td.d { white-space: nowrap; font-variant-numeric: tabular-nums; }
          .alt { display: inline-block; margin: 0 6px 4px 0; font-size: 12px; padding: 1px 6px; border: 1px solid var(--line); color: var(--dim); }
          .alt a { color: var(--blue); }
          .media { font-size: 12px; color: var(--dim); }
          .media div { margin-bottom: 2px; }
          .foot { margin-top: 32px; font-size: 13px; color: var(--dim); }
          @media (max-width: 720px) {
            thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
            table, tbody, tr, td { display: block; width: 100%; }
            tr { border-bottom: 1px solid var(--line); padding: 8px 0; }
            td { border: 0; padding: 4px 0; }
            td.n { text-align: left; }
            td:empty { display: none; }
            td[data-label]::before { content: attr(data-label) " "; font-size: 12px; font-weight: 600; color: var(--dim); }
          }
        </style>
      </head>
      <body>
        <main>
          <xsl:apply-templates select="s:urlset | s:sitemapindex"/>
          <p class="foot">This page is a sitemap: a list of pages for search engines, shown here in a readable form. <a href="https://yunzheng.space/">YunZheng LAB</a> · <a href="https://yunzheng.space/sitemap-index.xml">All sitemaps</a> · <a href="https://yunzheng.space/sitemap-all.xml">Every URL</a></p>
        </main>
      </body>
    </html>
  </xsl:template>

  <!-- A sitemap index: each child, its URL count and last change. -->
  <xsl:template match="s:sitemapindex">
    <span class="badge">Sitemap index</span>
    <h1>YunZheng LAB sitemaps</h1>
    <p>Sitemaps: <xsl:value-of select="count(s:sitemap)"/> · URLs: <xsl:value-of select="normalize-space(substring-after(comment()[starts-with(normalize-space(.), 'urls-total:')], 'urls-total:'))"/> in all. Open one to see its pages, or <a href="/sitemap-all.xml">every URL on one page</a>.</p>
    <table>
      <thead><tr><th>Sitemap</th><th class="n">URLs</th><th>Last modified</th></tr></thead>
      <tbody>
        <xsl:for-each select="s:sitemap">
          <tr>
            <td data-label="Sitemap"><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
            <td class="n" data-label="URLs"><xsl:value-of select="normalize-space(substring-after(comment()[starts-with(normalize-space(.), 'urls:')], 'urls:'))"/></td>
            <td class="d" data-label="Last modified"><xsl:choose><xsl:when test="s:lastmod"><xsl:value-of select="s:lastmod"/></xsl:when><xsl:otherwise>not stated</xsl:otherwise></xsl:choose></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </xsl:template>

  <!-- A set of URLs: counts per host, then one table per host. -->
  <xsl:template match="s:urlset">
    <span class="badge">Sitemap</span>
    <h1>
      <xsl:choose>
        <xsl:when test="count(s:url[generate-id() = generate-id(key('by-host', substring-before(concat(substring-after(s:loc, '://'), '/'), '/'))[1])]) = 1">
          <xsl:call-template name="host"><xsl:with-param name="u" select="s:url[1]/s:loc"/></xsl:call-template>
        </xsl:when>
        <xsl:otherwise>Every public URL</xsl:otherwise>
      </xsl:choose>
    </h1>
    <p>URLs: <xsl:value-of select="count(s:url)"/> · <xsl:value-of select="count(s:url[xhtml:link])"/> with language alternates · images: <xsl:value-of select="count(s:url/image:image)"/> · videos: <xsl:value-of select="count(s:url/video:video)"/></p>
    <ul class="counts">
      <xsl:for-each select="s:url[generate-id() = generate-id(key('by-host', substring-before(concat(substring-after(s:loc, '://'), '/'), '/'))[1])]">
        <xsl:variable name="h" select="substring-before(concat(substring-after(s:loc, '://'), '/'), '/')"/>
        <li><a href="#{$h}"><xsl:value-of select="$h"/></a><xsl:text> </xsl:text><b><xsl:value-of select="count(key('by-host', $h))"/></b></li>
      </xsl:for-each>
    </ul>
    <xsl:for-each select="s:url[generate-id() = generate-id(key('by-host', substring-before(concat(substring-after(s:loc, '://'), '/'), '/'))[1])]">
      <xsl:variable name="h" select="substring-before(concat(substring-after(s:loc, '://'), '/'), '/')"/>
      <h2 id="{$h}"><xsl:value-of select="$h"/> · <xsl:value-of select="count(key('by-host', $h))"/></h2>
      <table>
        <thead><tr><th>URL</th><th>Languages</th><th>Last modified</th><th>Images and videos</th></tr></thead>
        <tbody>
          <xsl:for-each select="key('by-host', $h)">
            <tr>
              <td data-label="URL"><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
              <td data-label="Languages">
                <xsl:for-each select="xhtml:link[@rel='alternate']">
                  <span class="alt"><a href="{@href}"><xsl:value-of select="@hreflang"/></a></span>
                </xsl:for-each>
              </td>
              <td class="d" data-label="Last modified"><xsl:value-of select="s:lastmod"/></td>
              <td class="media" data-label="Media">
                <xsl:for-each select="image:image">
                  <div>Image: <a href="{image:loc}"><xsl:value-of select="substring-after(substring-after(image:loc, '://'), '/')"/></a></div>
                </xsl:for-each>
                <xsl:for-each select="video:video">
                  <div>Video: <xsl:value-of select="video:title"/><xsl:if test="video:duration"> (<xsl:value-of select="floor(video:duration div 60)"/>:<xsl:value-of select="format-number(video:duration mod 60, '00')"/>)</xsl:if></div>
                </xsl:for-each>
              </td>
            </tr>
          </xsl:for-each>
        </tbody>
      </table>
    </xsl:for-each>
  </xsl:template>
</xsl:stylesheet>
