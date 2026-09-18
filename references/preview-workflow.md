# Direct-delivery workflow

1. Collect candidates from approved public web sources, including qualifying GitHub repositories and Skill sources.
2. Deduplicate, verify sources, and score value.
3. Group qualifying items into GitHub 精选, AI 情报, Skill 精选, and 综合情报. Apply the five-item minimum independently to every section: GitHub ≥ 5, AI ≥ 5, Skill ≥ 5, and 综合情报 ≥ 5; include all qualifying items in each deliverable section.
4. Omit a section with fewer than 5 qualifying items. Never lower the score, relax evidence rules, or create filler to reach five. If no section reaches five, prepare `本时段无合格高价值情报`.
5. Rewrite the retained items into one article: a title made of the day's leading headlines, a byline, a 速览 index listing every entry, then each entry as a short story in 2-5 paragraphs with its sources attributed inside the sentences. Entries are not numbered, sections carry no counts, and no field labels appear in the text. Write each entry's paragraphs into `body`; leaving it empty falls back to three paragraphs assembled from the older fragment fields. `references/article-layout.md` has the full structure, the per-field writing rules, and the `article.style` switch back to the original labelled layout.
6. Compose one Markdown briefing in this order: GitHub 精选, AI 情报, Skill 精选, 综合情报.
7. Follow `message-delivery-protocol.md`: proactively send the full briefing or no-content result through the host OpenClaw `message` tool to the configured destination. A normal response or stored artifact is not delivery.
8. Do not generate HTML, a webpage, a dashboard, a file link, or an external publication. Keep local structured evidence only when needed for verification and deduplication.