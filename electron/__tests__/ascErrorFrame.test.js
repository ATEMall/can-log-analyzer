import { describe, it, expect } from 'vitest';
import { parseASCErrorLine, classifyErrorCategory } from '../asc';

describe('R12 parseASCErrorLine — error frames', () => {
  it('parses the Vector classic form "<ts> <channel> ErrorFrame"', () => {
    const ev = parseASCErrorLine('1.234567 1 ErrorFrame');
    expect(ev).toBeTruthy();
    expect(ev.timestamp).toBeCloseTo(1.234567, 6);
    expect(ev.channel).toBe(1);
    expect(ev.kind).toBe('error-frame');
    expect(ev.category).toBe('other');
  });

  it('parses "CAN ErrorFrame" and "Error Frame" spellings', () => {
    expect(parseASCErrorLine('0.500000 CAN ErrorFrame')?.kind).toBe('error-frame');
    expect(parseASCErrorLine('0.500000 Error Frame')?.kind).toBe('error-frame');
  });

  it('classifies the trailing error text (stuff / form / ack / crc / bit)', () => {
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Stuff Error').category).toBe('stuff');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Form Error').category).toBe('form');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  ACK Error').category).toBe('ack');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  CRC Error').category).toBe('crc');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Bit1 Error').category).toBe('bit1');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Bit0 Error').category).toBe('bit0');
  });

  it('treats overload frames as their own category', () => {
    expect(parseASCErrorLine('0.2 1 OverloadFrame').category).toBe('overload');
  });
});

describe('R12 parseASCErrorLine — bus state events', () => {
  it('recognises Bus Off / Error Passive / Error Active', () => {
    expect(parseASCErrorLine('2.000000 CAN Bus Off').state).toBe('bus-off');
    expect(parseASCErrorLine('2.000000 1 BusOff').state).toBe('bus-off');
    expect(parseASCErrorLine('2.000000 Error Passive').state).toBe('error-passive');
    expect(parseASCErrorLine('2.000000 Error Active').state).toBe('error-active');
  });

  it('recognises the "Chip State:" spelling', () => {
    const ev = parseASCErrorLine('3.500000 Chip State: busoff');
    expect(ev).toBeTruthy();
    expect(ev.kind).toBe('bus-state');
    expect(ev.state).toBe('bus-off');
  });

  it('returns null for normal data lines', () => {
    expect(parseASCErrorLine('0.001000 1 123 Rx d 8 11 22 33 44 55 66 77 88')).toBeNull();
    expect(parseASCErrorLine('base hex  timestamps absolute')).toBeNull();
    expect(parseASCErrorLine('')).toBeNull();
    expect(parseASCErrorLine(null)).toBeNull();
  });
});

describe('R12 classifyErrorCategory', () => {
  it('defaults to "other" for unknown text', () => {
    expect(classifyErrorCategory('', false)).toBe('other');
    expect(classifyErrorCategory(undefined, false)).toBe('other');
  });
});
