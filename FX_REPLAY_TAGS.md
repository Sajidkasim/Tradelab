# Sajid's FX Replay tag guide

Confirmed from the owner's tag-group screenshot and full strategy names on
27 October 2026. Import → Import settings → Tag meanings holds the editable
guide. Suggested meanings are reviewed one tag at a time before saving; existing
saved meanings are retained. Saving a meaning does not import trades or relabel
existing records. The normal upload page shows only tags not yet in the guide.

## Adding strategies and changing tag names

Choose Add a tag, copy the exact CSV tag, choose its category, and give it a
clear name in PrimusLab. Strategy, level, confirmation, level timeframe, entry
timeframe, news and market-condition meanings are supported. New strategy,
confirmation and timeframe values become available in the editor/filter lists
without a code change. A combined tag can still have several explicit meanings.

Target RR accepts labels such as 1:3 and 1:2. Full target/full stop is a separate
explicit confirmation for each model, not an assumption made from a target tag.
The owner confirmed this for the current 1:3 test. The frontend can then show a
fixed-test average before costs, using the existing core summary. Recorded R
takes priority when present; no R, risk or dollar results are overwritten.

Another CSV name adds an alias without removing the old name. Point both names
to the same PrimusLab name to keep future results grouped consistently. Edit
changes a future import meaning; Forget this meaning removes that preference
without rewriting trades. Keep original tag only is a remembered choice that
retains the raw tag without classifying it, including legacy confirmation names.

Saved and New in this file lists are searchable. Saving a meaning automatically
refreshes an open CSV preview; changes still require Confirm import to save any
trades. File preferences (account, source, export clock, date format and the
optional label-update mode) save without needing an uploaded file. Column
matching stays under File preferences → Match columns manually.

## Confirmed starting guide

| FX Replay tag | PrimusLab field | Meaning |
| --- | --- | --- |
| DISPLACEMENT AT KEY LEVEL | Strategy | Displacement at key level |
| REVERSAL AT KEY LEVEL | Strategy | Reversal at key level |
| FVG | Key level / PDA | FVG |
| ORDERBLOCK | Key level / PDA | Order block |
| PDL PDH | Key level / PDA | Previous day high / low |
| MSS | Confirmation | MSS |
| CISD | Confirmation | CISD |
| SMT | Confirmation | SMT |
| WEEKLY | Level timeframe | Weekly |
| MONTHLY | Level timeframe | Monthly |
| 4HR | Level timeframe | 4H |
| 1HR | Level timeframe | 1H |
| 1M | Entry timeframe | 1m |
| 15S | Entry timeframe | 15s |
| 5M | Entry timeframe | 5m |

The supplied native CSV has one flat tags column, without group names. **15M**
appears in both timeframe groups and must not be assigned to both by inference.
Use **Level TF: 15M** and **Entry TF: 15M** as distinct FX Replay tags. The same
prefixes work for any timeframe used in both groups. Bare 15M remains unassigned
unless the owner explicitly saves a meaning; the preview explains the ambiguity.

FVG mapped as a key level is not an entry confirmation. When that approved
meaning overrides legacy bare-tag recognition, the original text is retained as
`fx-original:FVG` for audit and export. Other original labels are retained too.
An actual FVG confirmation can be tagged separately as **Confluence: FVG** and
mapped explicitly. Missing confirmations never mean confirmed absence.

Preview → Confirm import is still required. Re-importing existing trades skips
duplicates by default; Update labels on existing trades is opt-in and preserves
financial fields and existing notes. The tag guide is a workspace setting and
is included in JSON backups. No financial formula or core signature is changed.
