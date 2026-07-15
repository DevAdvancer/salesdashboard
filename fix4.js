const fs = require('fs');
const path = 'd:/salesdashboard/app/dashboard/page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Replace the state initialization
content = content.replace(
  `  // Date range — defaults to today in EST (single day).
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: getTodayEst(),
    to: getTodayEst(),
  }));`,
  `  // Date range — initially null to prevent hydration mismatch and double-fetching, initialized via useEffect.
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  // Initialize date range from localStorage
  useEffect(() => {
    const savedFilter = localStorage.getItem('dashboard_date_filter');
    const today = getTodayEst();
    if (savedFilter === 'month') {
      const monthStart = getMonthStartEst(new Date());
      setDateRange({ from: monthStart, to: today });
    } else {
      setDateRange({ from: today, to: today });
    }
  }, []);

  const handleDateRangeChange = (newRange: DateRange) => {
    setDateRange(newRange);
    const today = getTodayEst();
    const monthStart = getMonthStartEst(new Date());
    
    // We roughly match the range to determine the filter type
    if (newRange.from === newRange.to) {
      localStorage.setItem('dashboard_date_filter', 'today');
    } else if (newRange.from === monthStart && newRange.to === today) {
      localStorage.setItem('dashboard_date_filter', 'month');
    } else {
      localStorage.setItem('dashboard_date_filter', 'custom');
    }
  };`
);

// 2. Add safe ?. for dateRange in Referral split
content = content.replace(
  `  // Referral split uses the date range filter
  const monthStartKey = dateRange.from ?? getMonthStartEst(new Date());
  const monthEndKey = dateRange.to ?? getMonthEndEst(new Date());`,
  `  // Referral split uses the date range filter
  const monthStartKey = dateRange?.from ?? getMonthStartEst(new Date());
  const monthEndKey = dateRange?.to ?? getMonthEndEst(new Date());`
);

// 3. Update useEffect conditions
content = content.replace(
  `  // ── Fetch top metrics when range changes ──────────────────────────────
  useEffect(() => {
    if (!user) return;`,
  `  // ── Fetch top metrics when range changes ──────────────────────────────
  useEffect(() => {
    if (!user || !dateRange) return;`
);

content = content.replace(
  `  // ── Fetch KPI rows when range changes ─────────────────────────────────
  useEffect(() => {
    if (!user) return;`,
  `  // ── Fetch KPI rows when range changes ─────────────────────────────────
  useEffect(() => {
    if (!user || !dateRange) return;`
);

content = content.replace(
  `  // ── Fetch LinkedIn KPI rows when range changes ─────────────────────────
  useEffect(() => {
    if (!user) return;`,
  `  // ── Fetch LinkedIn KPI rows when range changes ─────────────────────────
  useEffect(() => {
    if (!user || !dateRange) return;`
);

content = content.replace(
  `  // ── Fetch payment insights (admin-like only) ──────────────────────────
  useEffect(() => {
    if (!user || !isAdminLike) {
      return;
    }`,
  `  // ── Fetch payment insights (admin-like only) ──────────────────────────
  useEffect(() => {
    if (!user || !isAdminLike || !dateRange) {
      return;
    }`
);

content = content.replace(
  `  // ── Fetch technical payments total for dashboard (all accessible technical payments in date range) ──
  useEffect(() => {
    if (!user || !isAdminLike) {
      setTechnicalPaymentsTotal(0);
      return;
    }`,
  `  // ── Fetch technical payments total for dashboard (all accessible technical payments in date range) ──
  useEffect(() => {
    if (!user || !isAdminLike || !dateRange) {
      setTechnicalPaymentsTotal(0);
      return;
    }`
);

content = content.replace(
  `  // ── Fetch referral split (admin-like only, current month by closedAt) ───
  useEffect(() => {
    if (!user || !isAdminLike) {
      return;
    }`,
  `  // ── Fetch referral split (admin-like only, current month by closedAt) ───
  useEffect(() => {
    if (!user || !isAdminLike || !dateRange) {
      return;
    }`
);

// 4. Update KPI targets & modes
content = content.replace(
  `  // KPI section mode + target derived from range
  const kpiMode = isSingleDay(dateRange) ? "daily" : "monthly";`,
  `  // KPI section mode + target derived from range
  const kpiMode = (dateRange && isSingleDay(dateRange)) ? "daily" : "monthly";`
);

content = content.replace(
  `  useEffect(() => {
    if (holidayDateKeys.length === 0) return;
    if (!dateRange.from || !dateRange.to || dateRange.from !== dateRange.to) return;
    if (!holidayDateKeys.includes(dateRange.from)) return;`,
  `  useEffect(() => {
    if (holidayDateKeys.length === 0 || !dateRange) return;
    if (!dateRange.from || !dateRange.to || dateRange.from !== dateRange.to) return;
    if (!holidayDateKeys.includes(dateRange.from)) return;`
);

content = content.replace(
  `  const kpiTarget: number = (() => {
    if (kpiRows && kpiRows.length > 0) return kpiRows[0].target;
    const fromIso = dateRange.from ?? getTodayEst();
    const toIso = dateRange.to ?? fromIso;
    return countWorkingDaysInRange(fromIso, toIso, holidayDateKeys);
  })();`,
  `  const kpiTarget: number = (() => {
    if (kpiRows && kpiRows.length > 0) return kpiRows[0].target;
    if (!dateRange) return 0;
    const fromIso = dateRange.from ?? getTodayEst();
    const toIso = dateRange.to ?? fromIso;
    return countWorkingDaysInRange(fromIso, toIso, holidayDateKeys);
  })();`
);

content = content.replace(
  `  async function reloadHolidayAwareDashboardData() {
    clearDashboardDataCache();
    if (!user) return;`,
  `  async function reloadHolidayAwareDashboardData() {
    clearDashboardDataCache();
    if (!user || !dateRange) return;`
);

content = content.replace(
  `  const initialLoading = !user;

  if (initialLoading) {`,
  `  const initialLoading = !user || !dateRange;

  if (initialLoading) {`
);

content = content.replace(
  `          <DashboardDateRange
            value={dateRange}
            onChange={setDateRange}`,
  `          <DashboardDateRange
            value={dateRange!}
            onChange={handleDateRangeChange}`
);

// Fallback for rangeLabel call
content = content.replace(
  `        rangeLabel={rangeLabel(dateRange)}`,
  `        rangeLabel={dateRange ? rangeLabel(dateRange) : ""}`
);
content = content.replace(
  `        rangeLabel={rangeLabel(dateRange)}`,
  `        rangeLabel={dateRange ? rangeLabel(dateRange) : ""}`
);
content = content.replace(
  `          rangeLabel={rangeLabel(dateRange)}`,
  `          rangeLabel={dateRange ? rangeLabel(dateRange) : ""}`
);
content = content.replace(
  `          rangeLabel={rangeLabel(dateRange)}`,
  `          rangeLabel={dateRange ? rangeLabel(dateRange) : ""}`
);
content = content.replace(
  `          dateFilter={dateRange}`,
  `          dateFilter={dateRange!}`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Update successful');
