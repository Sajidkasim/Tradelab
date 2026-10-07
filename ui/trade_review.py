"""One label editor for the trade list and import review."""
import streamlit as st
from core import edge
from services import trade_labels
from ui import access, components as c, state


def strategy_options():
    from ui.edge_lab import playbook
    db = state.get_db()
    return sorted(set(playbook()['strategies'] + [s.name for s in state.setups()] +
                      [s for s in state.trades().get('setup_name', []) if s]))


def editor(tid, remaining):
    from ui.edge_lab import label_fields
    db = state.get_db()
    trade = db.get_trade(tid)
    if trade is None:
        st.info('This trade is no longer available. Refresh the list.')
        return
    key = f'review_{tid}'
    defaults = edge.read_labels(trade.tags)
    remembered = st.session_state.get('last_review_setup')
    if remembered and st.button('Use previous setup', key=f'{key}_reuse'):
        for field, value in remembered['labels'].items():
            if field != 'confirmations':
                st.session_state[f'{key}_{field}'] = value
        defaults['confirmations'] = list(dict.fromkeys(defaults['confirmations'] + remembered['labels']['confirmations']))
        for value in list(dict.fromkeys(edge.CONFIRMATIONS + defaults['confirmations'])):
            st.session_state[f'{key}_confirm_{value}'] = value in remembered['labels']['confirmations']
        st.session_state[f'{key}_strategy'] = remembered['strategy']
        st.session_state[f'{key}_confirmed'] = False
    st.caption(f"Result {c.fmt_money(trade.net_pnl)} · Realised R {c.fmt_r(trade.r_multiple)}")
    with st.form(f'edge_review_{tid}'):
        options = strategy_options()
        strategy = st.selectbox('Strategy', options, index=options.index(trade.setup_name) if trade.setup_name in options else None,
                                accept_new_options=True, placeholder='Pick or type a strategy', key=f'{key}_strategy')
        labels = label_fields(key, defaults)
        confirmed = st.checkbox('I have checked the confirmations for this trade', value=defaults['reviewed'], key=f'{key}_confirmed',
                                help='Until checked, unticked confirmations mean not recorded, rather than absent.')
        with st.expander('Notes'):
            notes = st.text_area('Trade notes', value=trade.notes, key=f'{key}_notes')
        left, right = st.columns(2)
        save = left.form_submit_button('Save changes', use_container_width=True)
        next_trade = right.form_submit_button('Save & next', type='primary', use_container_width=True)
        if save or next_trade:
            db.update_trade(tid, **trade_labels.review_fields(trade, strategy or '', labels, notes, confirmed))
            state.bump()
            st.session_state['last_review_setup'] = {'strategy': strategy, 'labels': labels}
            st.session_state['edge_flash'] = 'Trade updated. Your results use the saved labels.'
            if next_trade:
                ids = list(remaining)
                index = ids.index(tid)
                st.session_state['review_next_id'] = ids[(index + 1) % len(ids)]
            st.rerun()

    with st.expander('Original tags from your export'):
        st.write(', '.join(t for t in trade.tags if not t.startswith('edge:')) or 'No export tags')
        mappings = state.setting(trade_labels.MAPPING_KEY, {})
        if mappings and st.button('Apply saved tag mappings', key=f'{key}_map'):
            fields, issues = trade_labels.mapped_fields(trade.tags, mappings, trade.setup_name)
            db.update_trade(tid, **fields); state.bump()
            for widget_key in list(st.session_state):
                if widget_key.startswith(f'{key}_'):
                    del st.session_state[widget_key]
            st.session_state['edge_flash'] = 'Saved mappings applied. ' + ' '.join(issues)
            st.rerun()
    with st.expander('Chart screenshot'):
        if access.safe_screenshot(trade.screenshot_path):
            st.image(str(access.safe_screenshot(trade.screenshot_path)), use_container_width=True)
        upload = None
        if access.can_store_screenshots():
            upload = st.file_uploader('Attach a chart', type=['png', 'jpg', 'jpeg'], key=f'{key}_screenshot')
        else:
            st.caption('Chart uploads will be available after persistent image storage is connected. Keep your original screenshots.')
        if upload is not None and st.button('Save screenshot', key=f'{key}_save_screenshot'):
            from pathlib import Path
            from uuid import uuid4
            path = access.screenshot_directory() / f'{uuid4().hex}{Path(upload.name).suffix.lower()}'
            path.write_bytes(upload.getbuffer())
            db.update_trade(tid, screenshot_path=str(path)); state.bump(); st.rerun()


def review_queue(df, pending_default=True):

    if 'edge_flash' in st.session_state:
        st.success(st.session_state.pop('edge_flash'))
    if df.empty:
        c.empty_state('Your review queue starts here', 'Import your first replay export, or use Add Trade.')
        st.page_link('views/import_.py', label='Import trades', icon=':material/upload:')
        return
    pending = trade_labels.needs_tagging(df)
    only_pending = st.toggle(f'Needs tagging · {int(pending.sum())}', value=pending_default, key='edge_pending',
                             help='Trades missing a strategy or confirmation review. Switch off to see every trade.')

    queue = (df[pending] if only_pending else df).sort_values('entry_time', ascending=False)
    if queue.empty:
        c.empty_state("You're up to date", 'Turn off Needs tagging to amend any trade.')
        return
    display = queue[['id', 'entry_time', 'symbol', 'direction', 'setup_name', 'net_pnl', 'r_multiple']].copy()
    display['setup_name'] = display['setup_name'].fillna('').replace('', 'Unclassified')
    with st.expander(f'Trade list · {len(display)}', expanded=not only_pending):
        c.show_df(display, state.tz(), labels={'id': 'Trade #', 'entry_time': 'Entry time', 'symbol': 'Market', 'direction': 'Side', 'setup_name': 'Strategy', 'net_pnl': 'Net P&L', 'r_multiple': 'Realised R'}, height=min(350, 38 + 35 * len(display)))
    records = {int(row.id): row for row in queue.itertuples()}
    def label(v):
        row = records[v]
        return f'{row.entry_time:%d %b %Y %H:%M} UTC · {row.symbol} · {row.direction} · {c.fmt_money(row.net_pnl)} · {row.setup_name or "Unclassified"} · #{v}'
    with st.expander('Tag several trades at once'):
        ids = st.multiselect('Trades to tag', list(records), format_func=label, key='review_bulk_ids')
        strategy = st.selectbox('Apply strategy', strategy_options(), index=None, accept_new_options=True, key='review_bulk_strategy')
        st.caption('Replaces the strategy on selected trades only. Other labels stay as they are.')
        if st.button('Apply to selected trades', disabled=not ids or not strategy, key='review_bulk_apply'):
            count = trade_labels.apply_strategy(state.get_db(), ids, strategy)
            state.bump()
            for selected_id in ids:
                st.session_state.pop(f'review_{selected_id}_strategy', None)
            st.session_state['edge_flash'] = f'Strategy saved on {count} trades.'
            st.rerun()
    target = st.session_state.pop('review_next_id', None)
    if target in records:
        st.session_state['edge_review_trade'] = target
    if st.session_state.get('edge_review_trade') not in records:
        st.session_state['edge_review_trade'] = next(iter(records))
    tid = st.selectbox('Open a trade to edit', list(records), format_func=label, key='edge_review_trade')
    editor(tid, records)
