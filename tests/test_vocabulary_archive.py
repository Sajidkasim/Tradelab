from copy import deepcopy
from tests.test_webapp import local, trade_payload


def test_archiving_choices_hides_them_but_keeps_history_and_can_restore(local):
    client,app=local
    client.put('/api/playbook',json={'strategies':['Kept','Old setup'],'levels':['FVG','Old level']})
    settings=deepcopy(client.get('/api/metadata').json()['lab_settings'])
    settings.update(level_timeframes=['4H','2H'],entry_timeframes=['1m','30s'])
    client.put('/api/lab-settings',json=settings)
    body=trade_payload(strategy='Old setup');body['labels'].update(level='Old level',timeframe='2H',entry_timeframe='30s')
    assert client.post('/api/trades',json=body).status_code==200
    trades=client.get('/api/trades').json()
    client.put('/api/playbook',json={'strategies':['Kept'],'levels':['FVG']})
    settings.update(level_timeframes=['4H'],entry_timeframes=['1m'])
    client.put('/api/lab-settings',json=settings)
    meta=client.get('/api/metadata').json()
    assert meta['strategies']==['Kept'] and meta['playbook']['levels']==['FVG']
    for key,old in [('strategies','Old setup'),('levels','Old level'),('level_timeframes','2H'),('entry_timeframes','30s')]:
        assert old in meta['archived_choices'][key]
    assert 'Strategy: Old setup' not in meta['automatic_tags']
    assert client.get('/api/trades').json()==trades
    filters={'scope':'All','combined':True,'window':'All sessions','strategy':'Old setup','level':'Old level','timeframe':'2H','entry_timeframe':'30s'}
    assert client.post('/api/results',json=filters).json()['stats']['trades']==1
    client.put('/api/playbook',json={'strategies':['Kept','Old setup'],'levels':['FVG','Old level']})
    settings.update(level_timeframes=['4H','2H'],entry_timeframes=['1m','30s'])
    client.put('/api/lab-settings',json=settings)
    assert 'Old setup' not in client.get('/api/metadata').json()['archived_choices']['strategies']
    assert client.get('/api/trades').json()==trades


def test_missing_label_sentinels_never_become_choices_or_archives(local):
    client,app=local
    client.put('/api/playbook',json={'strategies':['Unclassified','Not recorded','Actual setup'],'levels':['Not recorded','Actual level']})
    meta=client.get('/api/metadata').json()
    assert meta['strategies']==['Actual setup'] and meta['playbook']['levels']==['Actual level']
    assert all('Not recorded' not in values and 'Unclassified' not in values for values in meta['archived_choices'].values())
