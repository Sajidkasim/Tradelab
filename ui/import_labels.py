"""Preview and remember explicit tag mappings in this user's workspace."""
from copy import deepcopy
import streamlit as st
from services import trade_labels
from ui import state


def map_export_labels(trades, key):
    db = state.get_db()
    mappings = db.get_setting(trade_labels.MAPPING_KEY, {})
    tags = sorted({tag for trade in trades for tag in trade.tags
                   if not tag.startswith('edge:') and tag not in ('pnl-only', 'pnl-mismatch')})
    if not tags:
        return trades
    with st.expander('Recognise strategy tags', expanded=any(tag not in mappings for tag in tags)):
        st.caption('Tell PrimusLab what each export label means. Save once for future imports. Unmapped labels stay on the trade.')
        updated = dict(mappings)
        for i, tag in enumerate(tags):
            saved = mappings.get(tag, trade_labels.suggested_mapping(tag))
            columns = st.columns([2, 1.4, 2])
            columns[0].text(tag)
            options = [''] + list(trade_labels.FIELDS)
            field = columns[1].selectbox('Use as', options, index=options.index(saved.get('field', '')),
                                        format_func=lambda v: trade_labels.FIELDS.get(v, 'Keep as tag'), key=f'{key}_tag_{i}_field')
            value = columns[2].text_input('Value', value=saved.get('value', ''), key=f'{key}_tag_{i}_value',
                                          placeholder='e.g. Turtle Soup')
            updated[tag] = {'field': field, 'value': value.strip()}
        if st.button('Save tag mappings', key=f'{key}_save_tags'):
            db.set_setting(trade_labels.MAPPING_KEY, updated); state.bump(); st.rerun()
        st.caption('Only saved mappings are applied to the preview below. Missing tags never mean a confirmation was absent.')
    result = deepcopy(trades)
    warnings = set()
    for trade in result:
        fields, issues = trade_labels.mapped_fields(trade.tags, mappings, trade.setup_name)
        trade.setup_name, trade.tags = fields['setup_name'], fields['tags']
        warnings.update(issues)
    for issue in sorted(warnings):
        st.warning(issue)
    return result
