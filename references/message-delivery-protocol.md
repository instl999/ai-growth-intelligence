# Message delivery protocol

## Required completion path

1. Apply this protocol to both manual requests and scheduled 08:00/20:00 runs.
2. Resolve the permitted destination from the triggering request, current conversation, or scheduled-job configuration. Never invent a recipient, channel, or account.
3. Compose and validate the complete Markdown briefing before delivery.
4. Invoke the host OpenClaw `message` tool using the installed version's actual schema. Do not guess parameter names or send through a different tool.
5. Send the complete article in one message when the host permits it. If the host message limit requires splitting, send numbered consecutive parts such as `1/3`, `2/3`, `3/3`; every part must use `message` and preserve section order.
6. Treat a confirmed tool result as the only successful delivery condition. Record the returned receipt or message identifier when the host exposes one.
7. Use `message` for the no-content result `本时段无合格高价值情报` as well.

## Failure and duplicate prevention

- If `message` is unavailable, the destination is missing, permission is denied, or sending fails, set the outcome to `delivery_failed`. Do not claim success and do not silently fall back to a normal assistant response, local file, webpage, or stored article.
- If a call times out with an uncertain result, inspect the host receipt or recent delivery state before retrying. Do not blindly send the same briefing twice.
- Never send to a different recipient or channel merely because the configured destination is unavailable.