import React, {useState} from 'react';
import {Button, Field, Modal} from './components';

export default function ReplayClosePosition({position, session, onClose, onAction, disabled}) {
  const [quantity, setQuantity] = useState(String(position.qty));
  const [atLevel, setAtLevel] = useState(false);
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const qty = Number(quantity);
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= position.qty && (!atLevel || qty < position.qty);
  const target = position.partial_target;

  async function submit(kind) {
    setPending(true);
    setError('');
    try {
      await onAction(kind, kind === 'close' ? {close_qty: qty, close_price: atLevel ? Number(price) : null} : undefined);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }

  return <Modal title="Close position" className="bt-order-modal" onClose={() => !pending && onClose()}>
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      if (valid && !disabled && !pending && !target) submit('close');
    }}>
      <p>{position.side === 'buy' ? 'Long' : 'Short'} {session.instrument} · {position.qty} remaining</p>
      {!target && position.qty === 1 && <small>Only one unit remains. A partial close needs at least two.</small>}
      {target ? <>
        <p>Partial target pending · {target.qty} at {target.price}</p>
        <Button type="button" disabled={disabled} busy={pending} onClick={() => submit('cancel_partial')}>Cancel partial target</Button>
      </> : <>
        <div className="bt-close-presets" role="group" aria-label="Share of remaining position">
          {[25, 50, 75, 100].map(percent => {
            const size = Math.floor(position.qty * percent / 100);
            return <Button type="button" key={percent}
              disabled={size < 1 || (atLevel && size === position.qty) || pending}
              onClick={() => setQuantity(String(size))}>
                <span>{percent}%</span><small>{size > 0 ? `${size} to close` : 'Below minimum'}</small>
              </Button>;
          })}
        </div>
        <Field label="Quantity to close">
          <input required type="number" min="1" max={position.qty - Number(atLevel)} step="1"
            value={quantity} onChange={event => setQuantity(event.target.value)} disabled={pending}/>
        </Field>
        <label><input type="checkbox" checked={atLevel} disabled={position.qty < 2 || pending}
          onChange={event => {
            const checked = event.target.checked;
            setAtLevel(checked);
            if (checked && qty >= position.qty) setQuantity(String(position.qty - 1));
          }}/> Set a partial target price</label>
        {atLevel && <Field label="Partial target price">
          <input required type="number" min={session.tick_size || 0.25} step={session.tick_size || 0.25}
            value={price} onChange={event => setPrice(event.target.value)} disabled={pending}/>
        </Field>}
        <small>{atLevel ? 'Eligible from the next candle. Your stop still protects the remaining position.' : 'Fills at the next one-minute open with your session’s slippage.'}</small>
        <Button type="submit" variant="primary" disabled={disabled || !valid} busy={pending}>
          {atLevel ? 'Set partial target' : qty === position.qty ? 'Close full position' : 'Take partial'}
        </Button>
      </>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </form>
  </Modal>;
}
