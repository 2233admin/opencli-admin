import sys


def main():
    sys.stdout.reconfigure(encoding='utf-8', newline='\n')
    js = """
    (function() {
      try {
        const header = document.getElementById('rufus-panel-header-container');
        const textarea = document.getElementById('rufus-text-area');
        const style = textarea ? window.getComputedStyle(textarea) : null;
        const visible = style ? (style.display !== 'none' && style.visibility !== 'hidden') : false;
        return JSON.stringify({
          panelOpen: !!(header && visible),
          inputReady: !!(textarea && visible)
        });
      } catch(e) {
        return JSON.stringify({error: true, message: e.message});
      }
    })()
    """
    print(js)


if __name__ == '__main__':
    main()
