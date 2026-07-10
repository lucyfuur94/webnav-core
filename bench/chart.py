#!/usr/bin/env python3
"""Generate the navigation-benchmark charts from bench/results/data/nav-v2.json.

Reproducible: the report's graphs are GENERATED from the committed raw run data, never
hand-drawn. Run `python3 bench/chart.py` after adding/updating runs in the JSON; it rewrites
the SVGs under bench/results/charts/. Pure stdlib + matplotlib (already available).

Metric: toolCalls = agent-visible CLI calls per run = the cost signal (fewer = cheaper, since
each call typically ingests a page snapshot). We chart the MEDIAN over trials per (task, arm),
and the success rate (reachedGoal). Arm A = webnav walk · Arm C = raw browser.
"""
import json, os, statistics as st
from collections import defaultdict
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "bench", "results", "data", "nav-v2.json")
OUT = os.path.join(ROOT, "bench", "results", "charts")
os.makedirs(OUT, exist_ok=True)

A_COLOR, C_COLOR = "#7c4dff", "#9e9e9e"   # walk = brand purple, raw = grey

def load():
    return json.load(open(DATA))["runs"]

def by_task_arm(runs, field, reducer):
    agg = defaultdict(list)
    for r in runs:
        v = r.get(field)
        if v is not None:
            agg[(r["site"], r["taskId"], r["arm"])].append(v)
    return {k: reducer(v) for k, v in agg.items()}

def tasks_in_order(runs):
    seen = []
    for r in runs:
        key = (r["site"], r["taskId"])
        if key not in seen:
            seen.append(key)
    return seen

def chart_toolcalls(runs):
    med = by_task_arm(runs, "toolCalls", st.median)
    tasks = tasks_in_order(runs)
    labels = [f"{t[1]}\n({t[0]})" for t in tasks]
    a = [med.get((t[0], t[1], "A"), 0) for t in tasks]
    c = [med.get((t[0], t[1], "C"), 0) for t in tasks]
    x = range(len(tasks)); w = 0.38
    fig, ax = plt.subplots(figsize=(max(8, len(tasks) * 1.9), 4.6))
    b1 = ax.bar([i - w/2 for i in x], a, w, label="webnav walk (A)", color=A_COLOR)
    b2 = ax.bar([i + w/2 for i in x], c, w, label="raw browser (C)", color=C_COLOR)
    ax.bar_label(b1, padding=2, fontsize=9); ax.bar_label(b2, padding=2, fontsize=9)
    ax.set_ylabel("median agent-visible CLI calls\n(lower = cheaper)")
    ax.set_title("Agent steps to reach the goal — Haiku, lower is better", fontsize=12)
    ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=9)
    ax.legend(); ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "toolcalls.svg"))
    fig.savefig(os.path.join(OUT, "toolcalls.png"), dpi=130)
    plt.close(fig)
    print("wrote charts/toolcalls.{svg,png}")

def chart_success(runs):
    rate = by_task_arm(runs, "reachedGoal", lambda vs: round(100 * sum(1 for v in vs if v) / len(vs)))
    tasks = tasks_in_order(runs)
    labels = [f"{t[1]}\n({t[0]})" for t in tasks]
    a = [rate.get((t[0], t[1], "A"), 0) for t in tasks]
    c = [rate.get((t[0], t[1], "C"), 0) for t in tasks]
    x = range(len(tasks)); w = 0.38
    fig, ax = plt.subplots(figsize=(max(8, len(tasks) * 1.9), 4.6))
    b1 = ax.bar([i - w/2 for i in x], a, w, label="webnav walk (A)", color=A_COLOR)
    b2 = ax.bar([i + w/2 for i in x], c, w, label="raw browser (C)", color=C_COLOR)
    ax.bar_label(b1, fmt="%d%%", padding=2, fontsize=9); ax.bar_label(b2, fmt="%d%%", padding=2, fontsize=9)
    ax.set_ylabel("reached the goal (% of trials)"); ax.set_ylim(0, 109)
    ax.set_title("Reached-goal rate — higher is better", fontsize=12)
    ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=9)
    ax.legend(); ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "success.svg"))
    fig.savefig(os.path.join(OUT, "success.png"), dpi=130)
    plt.close(fig)
    print("wrote charts/success.{svg,png}")

if __name__ == "__main__":
    runs = load()
    chart_toolcalls(runs)
    chart_success(runs)
    print(f"charts from {len(runs)} runs -> {OUT}")
