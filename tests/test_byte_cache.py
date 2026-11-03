from webapp.byte_cache import ByteCache,size

def test_cache_evicts_by_actual_retained_size_and_skips_oversized_values():
    cache=ByteCache(500,entries=10)
    cache.put('first','a'*200);cache.put('second','b'*200);cache.put('third','c'*200)
    assert cache.bytes<=500 and cache.get('first') is None
    cache.put('oversized','z'*1000)
    assert cache.get('oversized') is None and cache.bytes<=500
    cache.put('third','short');assert cache.bytes<=500

def test_size_counts_shared_nested_objects_once():
    part=['x'*1000];assert size([part,part])<size([part,['y'*1000]])
