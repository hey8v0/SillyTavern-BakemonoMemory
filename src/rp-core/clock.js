const DAY = 86400000;
const pad = value => String(value).padStart(2, '0');
const leap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysInMonth = (year, month) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

export function readStoryDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value || ''));
    if (!match) return null;
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    if (match[4] !== undefined && (hour > 23 || minute > 59)) return null;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour || 0, minute || 0, 0, 0);
    return { iso: String(value), year, month, day, hour: hour || 0, minute: minute || 0,
        precision: match[4] === undefined ? 'day' : 'minute', milliseconds: date.getTime() };
}

export function advanceStoryDate(value, days) {
    const source = readStoryDate(value);
    if (!source || !Number.isSafeInteger(days) || Math.abs(days) > 3652059) return null;
    const result = new Date(source.milliseconds + days * DAY);
    const year = result.getUTCFullYear();
    if (year < 1 || year > 9999) return null;
    const date = String(year).padStart(4, '0') + '-' + pad(result.getUTCMonth() + 1) + '-' + pad(result.getUTCDate());
    return source.precision === 'minute' ? date + 'T' + pad(result.getUTCHours()) + ':' + pad(result.getUTCMinutes()) : date;
}

function anniversaryDate(source, year) {
    return String(year).padStart(4, '0') + '-' + (source.month === 2 && source.day === 29 && !leap(year)
        ? '03-01' : pad(source.month) + '-' + pad(source.day));
}

export function ageAt(birth, clock) {
    const start = readStoryDate(birth), current = readStoryDate(clock);
    if (!start || !current || start.milliseconds > current.milliseconds) return null;
    const birthday = readStoryDate(anniversaryDate(start, current.year));
    return current.year - start.year - (current.milliseconds < birthday.milliseconds ? 1 : 0);
}

export function anniversaryAt(origin, clock) {
    const start = readStoryDate(origin), current = readStoryDate(clock);
    if (!start || !current || start.milliseconds > current.milliseconds) return null;
    let year = Math.max(start.year + 1, current.year);
    let nextDate = anniversaryDate(start, year);
    if (nextDate < current.iso.slice(0, 10)) nextDate = anniversaryDate(start, ++year);
    if (year > 9999) return null;
    const next = readStoryDate(nextDate);
    return { nextDate, years: year - start.year,
        remainingDays: Math.round((next.milliseconds - readStoryDate(current.iso.slice(0, 10)).milliseconds) / DAY) };
}

export function planTimeState(plan, clock) {
    const due = readStoryDate(plan?.due), current = readStoryDate(clock);
    if (!due || !current) return { status: 'unknown', remainingDays: null };
    const remainingDays = Math.ceil((due.milliseconds - current.milliseconds) / DAY);
    if (due.precision === 'day') {
        const today = current.iso.slice(0, 10);
        return { status: today === due.iso ? 'due' : today < due.iso ? 'upcoming' : 'overdue', remainingDays };
    }
    if (current.precision === 'day' && due.iso.slice(0, 10) === current.iso) {
        return { status: 'unknown', remainingDays: 0 };
    }
    return { status: current.milliseconds === due.milliseconds ? 'due'
        : current.milliseconds < due.milliseconds ? 'upcoming' : 'overdue', remainingDays };
}
