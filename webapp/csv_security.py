"""Presentation-only CSV escaping; saved records and numeric values are unchanged."""
def safe_cell(value):
    if isinstance(value,str) and (value.startswith(('\t','\r','\n')) or value.lstrip(' \t\r\n\ufeff').startswith(('=','+','-','@'))):
        return "'"+value
    return value
