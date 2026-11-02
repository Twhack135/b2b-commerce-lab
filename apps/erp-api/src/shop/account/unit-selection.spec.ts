import { selectUnit } from './unit-selection';

const STUTTGART = { unitId: 'UNIT-STUTTGART', canOrder: true };
const MUENCHEN = { unitId: 'UNIT-MUENCHEN', canOrder: false };

describe('selectUnit', () => {
  it('takes the requested unit when the user is authorized for it', () => {
    expect(selectUnit([STUTTGART, MUENCHEN], 'UNIT-MUENCHEN')).toEqual({
      unit: MUENCHEN,
      requestedRejected: false,
    });
  });

  it('never selects a unit the user is not authorized for', () => {
    expect(selectUnit([STUTTGART, MUENCHEN], 'UNIT-WARSZAWA')).toEqual({
      unit: null,
      requestedRejected: true,
    });
    expect(selectUnit([], 'UNIT-STUTTGART')).toEqual({
      unit: null,
      requestedRejected: true,
    });
    // The match is exact: no case folding or prefixes
    expect(selectUnit([STUTTGART], 'unit-stuttgart').requestedRejected).toBe(
      true,
    );
  });

  it('falls back to the only authorized unit', () => {
    expect(selectUnit([STUTTGART], undefined)).toEqual({
      unit: STUTTGART,
      requestedRejected: false,
    });
    expect(selectUnit([STUTTGART], 'UNIT-MUENCHEN')).toEqual({
      unit: STUTTGART,
      requestedRejected: true,
    });
  });

  it('lets the user choose between several units', () => {
    expect(selectUnit([STUTTGART, MUENCHEN], undefined)).toEqual({
      unit: null,
      requestedRejected: false,
    });
  });
});
