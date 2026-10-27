# Sajid's FX Replay tag guide

Confirmed from the owner's tag-group screenshot and full strategy names on
27 October 2026. Import → Recognise strategy tags offers this guide before a
file is uploaded. Save tag meanings remembers it in the private workspace;
saved custom meanings override suggestions. Saving the guide does not import
trades or relabel existing records.

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
