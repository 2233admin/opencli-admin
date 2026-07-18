# Linear-scale Inbox

## Problem

The current Inbox is rendered as a rounded card inside a conventional page header. At 1440×1288 the operating surface uses only about 49% of the viewport, the queue starts 246 px below the top of the screen, and the list viewport is only 237 px tall. This does not match a high-frequency operations console and does not scale to hundreds of signals.

## Outcome

Turn `/inbox` into a full-height, edge-to-edge workbench inspired by Linear Inbox:

- compact workspace header;
- independently scrolling signal list and detail pane;
- dense, keyboard-first queue navigation;
- URL-preserved filters and search;
- progressive loading for hundreds of signals;
- no new UI dependency or invented backend state.

## Non-goals

- Adding read, unread, snooze, dismiss, or delete behavior without backend APIs.
- Changing the global sidebar, application routes, or the underlying task, notification, and control-action destinations.
- Rebranding the application or importing Linear's visual assets.
