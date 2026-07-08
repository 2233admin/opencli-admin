import argparse
import sys


def main():
    sys.stdout.reconfigure(encoding='utf-8', newline='\n')

    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=10,
                        help='Max number of tweets to return (default 10)')
    args = parser.parse_args()

    js = f"""
    (function() {{
      try {{
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        const replyBtns = Array.from(document.querySelectorAll('[data-testid="reply"]'));

        const limit = {args.limit};
        const tweets = articles.slice(0, limit).map((a, i) => {{
          const textEl = a.querySelector('[data-testid="tweetText"]');
          const tweetSnippet = textEl ? textEl.innerText.slice(0, 280) : '';

          const userNameEl = a.querySelector('[data-testid="User-Name"]');
          const authorLinks = userNameEl ? Array.from(userNameEl.querySelectorAll('a[href]')) : [];
          const profileLink = authorLinks.find(l => l.href && !l.href.includes('/status/'));
          const authorUrl = profileLink ? profileLink.href : '';
          const handleMatch = authorUrl.match(/x\\.com\\/([^/?]+)/);
          const authorHandle = handleMatch ? '@' + handleMatch[1] : '';

          const permalinkEl = a.querySelector('a[href*="/status/"]');
          const tweetUrl = permalinkEl ? permalinkEl.href : '';

          const replyBtn = a.querySelector('[data-testid="reply"]');
          const replyBtnIdx = replyBtn ? replyBtns.indexOf(replyBtn) : -1;

          return {{ i, tweetSnippet, authorHandle, authorUrl, tweetUrl, replyBtnIdx }};
        }});

        return JSON.stringify({{
          totalReplyBtns: replyBtns.length,
          tweets
        }});
      }} catch(e) {{
        return JSON.stringify({{ error: true, message: e.message }});
      }}
    }})()
    """
    print(js)


if __name__ == '__main__':
    main()
