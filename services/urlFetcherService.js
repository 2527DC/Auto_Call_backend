'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const sanitizeHtml = require('sanitize-html');

class UrlFetcherService {
  async fetchContent(url) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      const html = response.data;
      if (!html) {
        throw new Error('The URL returned empty content.');
      }

      const $ = cheerio.load(html);
      $('script, style, nav, footer, header, noscript').remove();

      const text = $('body').text();
      const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();

      if (cleanText.length < 50) {
        throw new Error('Could not extract enough text content from this page.');
      }

      return {
        title: $('title').text() || url,
        content: cleanText,
        html: html
      };
    } catch (error) {
      console.error(`Error fetching URL ${url}:`, error.message);

      let userFriendlyMessage = 'Failed to fetch content from the URL.';

      if (error.response) {
        const status = error.response.status;
        if (status === 403) {
          userFriendlyMessage = 'Access denied: This website blocks automated access. Please copy and paste the content manually.';
        } else if (status === 404) {
          userFriendlyMessage = 'The requested URL was not found. Please check the link.';
        } else if (status >= 500) {
          userFriendlyMessage = 'The website is currently unavailable. Please try again later.';
        } else {
          userFriendlyMessage = `The website returned an error (Status: ${status}).`;
        }
      } else if (error.code === 'ECONNABORTED') {
        userFriendlyMessage = 'The request timed out. The website might be too slow.';
      } else if (error.message) {
        userFriendlyMessage = error.message;
      }

      throw new Error(userFriendlyMessage);
    }
  }
}

module.exports = new UrlFetcherService();