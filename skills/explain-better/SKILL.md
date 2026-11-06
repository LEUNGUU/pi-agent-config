---
name: explain-better
description: Re-explain a topic or a previous answer in a format that is easier to understand. Use when the user says "explain better", "I don't get it", "make it clearer", "STE", "draw a diagram", "make an HTML explainer", or "解释清楚点", "看不懂", "画个图", "做成网页".
---

# Explain Better

Plain-language text rules are always on (extensions/explain-better.ts). This skill adds two richer formats.
Pick ONE. If the user names one, use it. If not, use the simplest one that fits.
If the user only says "I don't get it", first try the same topic from a different angle (example, analogy, or diagram).

## 1. Diagram
Output a Mermaid diagram (flowchart, sequence, or mindmap) and 3 to 5 lines of caption.
Use it for processes, architecture, and relationships.
The terminal renders Mermaid inline. Do not tell the user to paste it elsewhere.

## 2. HTML explainer
Write one self-contained `.html` file (inline CSS/JS, no build step) to `/tmp/explain-<topic>.html`, then run `open` on it.
Include: a one-sentence summary at the top, an interactive part (slider, toggle, or step-through), and short text.
