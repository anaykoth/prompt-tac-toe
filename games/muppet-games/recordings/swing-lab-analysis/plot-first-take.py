"""Plot the untouched first phone take and its reviewed three swing peaks."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

here = Path(__file__).resolve().parent
root = here.parent.parent
report = json.loads((here / 'first-three-swings.json').read_text())
take = json.loads((root / report['source']).read_text())['takes'][0]
seconds = np.array([s['t'] / 1000 for s in take['samples']])
rates = np.array([s['rate'] for s in take['samples']])
speed = np.linalg.norm(rates, axis=1)
bg, panel, cream, muted = '#14372f', '#193f35', '#f8f2d9', '#b8cdbd'
gold, orange, mint = '#f1d376', '#ff9a6c', '#9cdbbc'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                     'text.color': cream, 'axes.labelcolor': muted,
                     'xtick.color': muted, 'ytick.color': muted,
                     'svg.fonttype': 'none'})
fig, axes = plt.subplots(2, 1, figsize=(12, 7.1), sharex=True,
                         gridspec_kw={'height_ratios': [1.15, 1]}, facecolor=bg)
fig.subplots_adjust(left=.085, right=.965, bottom=.16, top=.76, hspace=.18)
fig.text(.085, .944, 'FELT FAIRWAY / SWING LAB', color=orange, fontsize=10, weight='bold')
fig.text(.085, .882, 'Three swings. One take.', fontsize=27, weight='bold')
fig.text(.085, .832, 'Two strong swings, then a deliberately gentler third.', color=muted, fontsize=12)
fig.text(.965, .882, '12 seconds  /  716 samples', ha='right', fontsize=11)
fig.text(.965, .842, 'Approx. 59 Hz  /  all motion fields present', ha='right', color=muted, fontsize=10)
for ax in axes:
    ax.set_facecolor(panel)
    ax.spines[['top', 'right']].set_visible(False)
    ax.spines[['bottom', 'left']].set_color('#557062')
    ax.grid(axis='y', color=cream, alpha=.1, linewidth=.6)
    ax.set_xlim(0, 12)
    ax.tick_params(length=0, pad=8)

axes[0].plot(seconds, speed, color=gold, linewidth=1.6)
axes[0].fill_between(seconds, speed, color=gold, alpha=.08)
axes[0].set_ylim(0, 1100)
axes[0].set_yticks([0, 250, 500, 750, 1000])
axes[0].set_ylabel('Total rotation (°/s)', labelpad=10)
for s in report['swings']:
    x, y = s['rotationPeakAtMs'] / 1000, s['rotationPeakDegreesPerSecond']
    axes[0].scatter([x], [y], s=30, color=cream, zorder=4)
    axes[0].annotate(f"SWING {s['swing']}\n{x:.2f} s · {y:.0f}°/s", (x, y),
                     xytext=(x + .22, y + 125), color=cream, fontsize=10,
                     arrowprops={'arrowstyle': '-', 'color': muted, 'linewidth': .8})
    axes[1].axvline(x, color=cream, alpha=.15, linewidth=1)

for i, (label, color) in enumerate(zip(['α', 'β', 'γ'], [gold, orange, mint])):
    axes[1].plot(seconds, rates[:, i], color=color, linewidth=1.2, label=label)
axes[1].axhline(0, color=cream, linewidth=.7, alpha=.3)
axes[1].set_ylabel('Signed axes (°/s)', labelpad=10)
axes[1].set_xlabel('Seconds from start of recording', labelpad=12)
axes[1].set_xticks(range(13))
axes[1].set_yticks([-600, -300, 0, 300, 600])
axes[1].legend(loc='upper right', ncol=3, frameon=False, labelcolor=cream)
axes[0].axvspan(11.687, 11.853, color=orange, alpha=.2)
axes[0].text(11.65, 1000, '166 ms gap\nafter the swings', ha='right', va='top', color=muted, fontsize=8)
fig.text(.085, .055, 'Phone rotation, not clubhead speed. First swing is already moving when capture starts.', fontsize=9, color=muted)
fig.text(.085, .027, 'No grip presses were recorded: this was a free-movement Lab take, with no game shots triggered.', fontsize=9, color=muted)
fig.savefig(here / 'first-three-swings.png', dpi=160, facecolor=bg)
fig.savefig(here / 'first-three-swings.svg', facecolor=bg)
plt.close(fig)
print(here / 'first-three-swings.png')
