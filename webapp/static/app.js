(function () {
  const form = document.getElementById('run-form');
  const statusMessageEl = document.getElementById('status-message');
  const jobsTableBody = document.querySelector('#jobs-table tbody');
  const portfolioSelector = document.getElementById('portfolio-selector');
  const pollers = new Map();
  let portfolioDirs = [];
  let selectedPortfolio = localStorage.getItem('selectedPortfolio') || '';

  const PROGRAM_COLOR_PALETTE = [
    '#1f77b4',
    '#ff7f0e',
    '#2ca02c',
    '#d62728',
    '#9467bd',
    '#8c564b',
    '#e377c2',
    '#7f7f7f',
    '#17becf',
    '#bcbd22'
  ];
  const DEFAULT_PROGRAM_COLOR = '#2563eb';
  let programsData = [];
  let originalProgramsData = [];
  let programsDirty = false;
  let programsLoadedPortfolio = null;
  let programColorMap = new Map();
  let cachedTimelineData = null;
  let cachedTimelinePortfolio = null;
  let cachedUnallocatedHtml = null;
  let cachedUnallocatedPortfolio = null;
  let cachedResourceAllocationData = null;
  let cachedResourceAllocationPortfolio = null;
  const PROGRAM_FILTER_ALL = '__all__';
  const PROGRAM_FILTER_NO_PROGRAM = '__no_program__';
  let projectProgramFilter = PROGRAM_FILTER_ALL;
  let timelineSortMode = 'none'; // 'none', 'program', 'start_date'
  let configData = null;
  let originalConfigData = null;
  let configDirty = false;
  let configErrors = {};
  let configLoadedPortfolio = null;
  let modellerConfigCache = null;

  function setStatus(text) {
    if (statusMessageEl) {
      statusMessageEl.textContent = text || '';
    }
  }

  async function refreshDirList() {
    try {
      const response = await fetch('/dirs');
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (payload && Array.isArray(payload.projects)) {
        portfolioDirs = payload.projects;

        // Update portfolio selector
        if (portfolioSelector) {
          const currentValue = portfolioSelector.value;
          portfolioSelector.innerHTML = '<option value="">Select a portfolio...</option>';
          portfolioDirs.forEach((entry) => {
            if (entry && entry.name) {
              const option = document.createElement('option');
              option.value = entry.name;
              option.textContent = entry.name;
              portfolioSelector.appendChild(option);
            }
          });

          // Restore previously selected portfolio if it still exists
          if (selectedPortfolio && portfolioDirs.some(d => d.name === selectedPortfolio)) {
            portfolioSelector.value = selectedPortfolio;
          }
        }
      }
    } catch (err) {
      console.warn('Unable to refresh portfolio directories', err);
    }
  }

  function updateProjectDirInput() {
    // No longer needed - removed project-dir input field
  }

  function expandShortHex(color) {
    const hex = color.replace('#', '');
    if (hex.length !== 3) {
      return color;
    }
    return `#${hex.split('').map((ch) => ch + ch).join('')}`;
  }

  function hexToRgb(hex) {
    if (!hex) {
      return null;
    }
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) {
      return null;
    }
    const intVal = Number.parseInt(normalized, 16);
    if (Number.isNaN(intVal)) {
      return null;
    }
    return {
      r: (intVal >> 16) & 255,
      g: (intVal >> 8) & 255,
      b: intVal & 255
    };
  }

  function rgbToHex(r, g, b) {
    const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((component) => component.toString(16).padStart(2, '0')).join('')}`;
  }

  function mixColors(base, mixWith, amount) {
    const baseRgb = hexToRgb(base);
    const mixRgb = hexToRgb(mixWith);
    if (!baseRgb || !mixRgb) {
      return base;
    }
    const t = Math.max(0, Math.min(1, amount));
    const r = (1 - t) * baseRgb.r + t * mixRgb.r;
    const g = (1 - t) * baseRgb.g + t * mixRgb.g;
    const b = (1 - t) * baseRgb.b + t * mixRgb.b;
    return rgbToHex(r, g, b);
  }

  function shadeColor(hex, percent) {
    if (!hex) {
      return DEFAULT_PROGRAM_COLOR;
    }
    if (percent >= 0) {
      return mixColors(hex, '#ffffff', percent);
    }
    return mixColors(hex, '#000000', Math.abs(percent));
  }

  function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) {
      return '';
    }
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }

  function getContrastingTextColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) {
      return '#ffffff';
    }
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.6 ? '#1f2937' : '#ffffff';
  }

  function generateColorFromName(name, index = 0) {
    const fallback = PROGRAM_COLOR_PALETTE[index % PROGRAM_COLOR_PALETTE.length] || DEFAULT_PROGRAM_COLOR;
    if (!name) {
      return fallback;
    }
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
      hash |= 0; // Convert to 32bit integer
    }
    const hue = Math.abs(hash) % 360;
    const saturation = 65;
    const lightness = 55;
    return hslToHex(hue, saturation, lightness);
  }

  function hslToHex(h, s, l) {
    const sat = Math.max(0, Math.min(100, s)) / 100;
    const light = Math.max(0, Math.min(100, l)) / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const f = (n) => light - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
    return `#${[f(0), f(8), f(4)].map((value) => {
      const channel = Math.round(value * 255);
      return channel.toString(16).padStart(2, '0');
    }).join('')}`;
  }

  function sanitizeProgramColor(color, fallbackName, index = 0) {
    if (typeof color === 'string' && color.trim()) {
      let normalized = color.trim();
      if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
        normalized = expandShortHex(normalized);
      }
      if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
        return normalized.toLowerCase();
      }
    }
    return generateColorFromName(fallbackName, index).toLowerCase();
  }

  function normalizeProgramRow(row, index) {
    const name = (row.name || row.Program || row.program || row.program_name || row.ProgramName || '').toString().trim();
    const color = sanitizeProgramColor(row.color || row.Color || row.colour || row.Colour || '', name, index);
    return {
      name,
      color
    };
  }

  function rebuildProgramColorMap() {
    const newMap = new Map();
    programsData.forEach((program, index) => {
      const trimmedName = (program.name || '').trim();
      if (!trimmedName) {
        program.color = generateColorFromName(`Program ${index + 1}`, index).toLowerCase();
        return;
      }
      const normalizedColor = sanitizeProgramColor(program.color || '', trimmedName, index);
      program.color = normalizedColor;
      newMap.set(trimmedName.toLowerCase(), normalizedColor);
    });
    programColorMap = newMap;
  }

  function getProgramColor(programName, index = 0) {
    if (!programName) {
      return generateColorFromName('', index);
    }
    const key = programName.trim().toLowerCase();
    if (programColorMap.has(key)) {
      return programColorMap.get(key);
    }
    const color = generateColorFromName(programName, index);
    programColorMap.set(key, color);
    return color;
  }

  function getProgramBackground(color) {
    if (!color) {
      return '';
    }
    return hexToRgba(color, 0.12);
  }

  function resetProgramsState() {
    programsData = [];
    originalProgramsData = [];
    programsDirty = false;
    programsLoadedPortfolio = null;
    programColorMap = new Map();
    updateProgramsUnsavedIndicator();
  }

  function createProgramKey(name) {
    if (typeof name !== 'string') {
      return '';
    }
    return name.trim().toLowerCase();
  }

  function computeValidProgramFilterValues(options, includeNoProgram) {
    const values = new Set([PROGRAM_FILTER_ALL]);
    options.forEach((entry) => {
      if (entry && entry.value) {
        values.add(entry.value);
      }
    });
    if (includeNoProgram) {
      values.add(PROGRAM_FILTER_NO_PROGRAM);
    }
    return values;
  }

  function populateProgramFilterSelect(selectId, options, includeNoProgram) {
    const select = document.getElementById(selectId);
    if (!select) {
      return;
    }

    const fragment = document.createDocumentFragment();

    const allOption = document.createElement('option');
    allOption.value = PROGRAM_FILTER_ALL;
    allOption.textContent = 'All Programs';
    fragment.appendChild(allOption);

    options.forEach((entry) => {
      if (!entry || !entry.value) {
        return;
      }
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      fragment.appendChild(option);
    });

    if (includeNoProgram) {
      const option = document.createElement('option');
      option.value = PROGRAM_FILTER_NO_PROGRAM;
      option.textContent = 'No Program';
      fragment.appendChild(option);
    }

    select.innerHTML = '';
    select.appendChild(fragment);
  }

  function syncProgramFilterSelects() {
    ['project-program-filter', 'timeline-program-filter'].forEach((id) => {
      const select = document.getElementById(id);
      if (!select) {
        return;
      }
      const options = Array.from(select.options || []);
      const hasValue = options.some((opt) => opt.value === projectProgramFilter);
      select.value = hasValue ? projectProgramFilter : PROGRAM_FILTER_ALL;
    });
  }

  function collectProgramOptionsFromProjects() {
    const seen = new Map();
    let includeNoProgram = false;

    projectsData.forEach((project) => {
      const raw = project && typeof project.parent_summary === 'string' ? project.parent_summary : '';
      const trimmed = raw.trim();
      const key = createProgramKey(trimmed);
      if (!key) {
        if (trimmed === '') {
          includeNoProgram = true;
        }
        return;
      }
      if (!seen.has(key)) {
        seen.set(key, trimmed);
      }
    });

    programsData.forEach((program) => {
      const raw = program && typeof program.name === 'string' ? program.name : '';
      const trimmed = raw.trim();
      const key = createProgramKey(trimmed);
      if (!key) {
        return;
      }
      if (!seen.has(key)) {
        seen.set(key, trimmed);
      }
    });

    const options = Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, label]) => ({ value, label }));

    return { options, includeNoProgram };
  }

  function collectProgramOptionsFromTimeline(rows) {
    const seen = new Map();
    let includeNoProgram = false;

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const raw = row && typeof row.parent_summary === 'string' ? row.parent_summary : '';
      const trimmed = raw.trim();
      const key = createProgramKey(trimmed);
      if (!key) {
        if (trimmed === '') {
          includeNoProgram = true;
        }
        return;
      }
      if (!seen.has(key)) {
        seen.set(key, trimmed);
      }
    });

    programsData.forEach((program) => {
      const raw = program && typeof program.name === 'string' ? program.name : '';
      const trimmed = raw.trim();
      const key = createProgramKey(trimmed);
      if (!key) {
        return;
      }
      if (!seen.has(key)) {
        seen.set(key, trimmed);
      }
    });

    const options = Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, label]) => ({ value, label }));

    return { options, includeNoProgram };
  }

  function updateProjectProgramFilterOptions() {
    const previousFilter = projectProgramFilter;
    const { options, includeNoProgram } = collectProgramOptionsFromProjects();
    const validValues = computeValidProgramFilterValues(options, includeNoProgram);
    if (!validValues.has(projectProgramFilter)) {
      projectProgramFilter = PROGRAM_FILTER_ALL;
    }
    populateProgramFilterSelect('project-program-filter', options, includeNoProgram);
    syncProgramFilterSelects();
    return previousFilter !== projectProgramFilter;
  }

  function updateTimelineProgramFilterOptions(rows) {
    const previousFilter = projectProgramFilter;
    const { options, includeNoProgram } = collectProgramOptionsFromTimeline(rows);
    const validValues = computeValidProgramFilterValues(options, includeNoProgram);
    if (!validValues.has(projectProgramFilter)) {
      projectProgramFilter = PROGRAM_FILTER_ALL;
    }
    populateProgramFilterSelect('timeline-program-filter', options, includeNoProgram);
    syncProgramFilterSelects();
    return previousFilter !== projectProgramFilter;
  }

  function matchesProgramFilter(programName) {
    if (projectProgramFilter === PROGRAM_FILTER_ALL) {
      return true;
    }
    const key = createProgramKey(programName);
    if (projectProgramFilter === PROGRAM_FILTER_NO_PROGRAM) {
      return key === '';
    }
    return key === projectProgramFilter;
  }

  function normalizeProgramFilterValue(value) {
    if (value === PROGRAM_FILTER_NO_PROGRAM) {
      return PROGRAM_FILTER_NO_PROGRAM;
    }
    if (value === PROGRAM_FILTER_ALL || typeof value !== 'string') {
      return PROGRAM_FILTER_ALL;
    }
    return createProgramKey(value);
  }

  function handleProgramFilterChange(event) {
    const rawValue = event && event.target ? event.target.value : PROGRAM_FILTER_ALL;
    const normalized = normalizeProgramFilterValue(rawValue);
    if (normalized !== projectProgramFilter) {
      projectProgramFilter = normalized;
      syncProgramFilterSelects();
      renderEditableProjectsTable();
      rerenderTimelineFromCache();
    } else {
      syncProgramFilterSelects();
    }
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function deepEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (typeof a !== typeof b) {
      return false;
    }
    if (a === null || b === null) {
      return a === b;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i += 1) {
        if (!deepEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a).sort();
      const bKeys = Object.keys(b).sort();
      if (!deepEqual(aKeys, bKeys)) {
        return false;
      }
      for (const key of aKeys) {
        if (!deepEqual(a[key], b[key])) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  function setNestedValue(obj, path, value) {
    if (!obj || !path) {
      return;
    }
    const segments = Array.isArray(path) ? [...path] : path.split('.');
    let target = obj;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (typeof target[segment] !== 'object' || target[segment] === null) {
        target[segment] = {};
      }
      target = target[segment];
    }
    target[segments[segments.length - 1]] = value;
  }

  function resetConfigState() {
    configData = null;
    originalConfigData = null;
    configDirty = false;
    configErrors = {};
    configLoadedPortfolio = null;
    const saveBtn = document.getElementById('save-config-btn');
    const discardBtn = document.getElementById('discard-config-btn');
    if (saveBtn) {
      saveBtn.style.display = 'none';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
    if (discardBtn) {
      discardBtn.style.display = 'none';
    }
    updateConfigUnsavedIndicator();
  }

  function cloneConfigData(data) {
    if (data === null || data === undefined) {
      return null;
    }
    return deepClone(data);
  }

  function hasUnsavedConfigChanges() {
    if (!configData && !originalConfigData) {
      return false;
    }
    if (!configData || !originalConfigData) {
      return true;
    }
    return !deepEqual(configData, originalConfigData);
  }

  function updateConfigUnsavedIndicator() {
    const indicator = document.getElementById('unsaved-config-indicator');
    const discardBtn = document.getElementById('discard-config-btn');
    const hasChanges = hasUnsavedConfigChanges();
    configDirty = hasChanges;
    if (indicator) {
      if (hasChanges) {
        indicator.classList.add('visible');
      } else {
        indicator.classList.remove('visible');
      }
    }
    if (discardBtn) {
      discardBtn.style.display = hasChanges ? 'inline-block' : 'none';
    }
  }

  // Handle portfolio selector change
  if (portfolioSelector) {
    portfolioSelector.addEventListener('change', (e) => {
      selectedPortfolio = e.target.value;
      if (selectedPortfolio) {
        localStorage.setItem('selectedPortfolio', selectedPortfolio);
      } else {
        localStorage.removeItem('selectedPortfolio');
      }
      resetProgramsState();
      resetConfigState();
      modellerConfigCache = null;
      cachedTimelineData = null;
      cachedTimelinePortfolio = null;
      cachedResourceAllocationData = null;
      cachedResourceAllocationPortfolio = null;
      cachedUnallocatedHtml = null;
      cachedUnallocatedPortfolio = null;
      projectsData = [];
      originalProjectsData = [];
      projectProgramFilter = PROGRAM_FILTER_ALL;
      updateProjectProgramFilterOptions();
      updateTimelineProgramFilterOptions([]);
      updateProjectDirInput();

      // Check if there are running jobs for the newly selected portfolio
      checkRunningJobsForPortfolio();

      // Remove results badge when changing portfolios
      const resultsTab = document.querySelector('.tab[data-tab="results"]');
      if (resultsTab) {
        const badge = resultsTab.querySelector('.results-badge');
        if (badge) {
          badge.remove();
        }
      }

      // Refresh data if on those tabs
      const activeTab = document.querySelector('.tab.active');
      if (activeTab) {
        const tabName = activeTab.dataset.tab;
        if (tabName === 'files') {
          loadFiles();
        } else if (tabName === 'people') {
          // Check if we're on the allocation subtab
          const activeSubtab = document.querySelector('.subtab.active');
          if (activeSubtab && activeSubtab.dataset.subtab === 'people-allocation') {
            loadResourceAllocation();
          }
        } else if (tabName === 'settings') {
          loadConfig();
        }
      }
    });
  }

  function ensureJobRow(job) {
    let row = jobsTableBody.querySelector(`tr[data-job-id="${job.id}"]`);
    if (!row) {
      row = document.createElement('tr');
      row.dataset.jobId = job.id;
      row.innerHTML = [
        `<td class="job-id"><a href="/status/${job.id}" target="_blank" rel="noopener">${job.id}</a></td>`,
        '<td class="job-project"></td>',
        '<td class="job-state"></td>',
        '<td class="job-created"></td>',
        '<td class="job-started"></td>',
        '<td class="job-finished"></td>',
        '<td class="job-message"></td>',
      ].join('');
      if (jobsTableBody.firstChild) {
        jobsTableBody.insertBefore(row, jobsTableBody.firstChild);
      } else {
        jobsTableBody.appendChild(row);
      }
    }
    return row;
  }

  function applyStateClass(cell, state) {
    if (!cell) {
      return;
    }
    cell.className = `job-state state-${state}`;
    cell.textContent = state;
  }

  function updateJobRow(job) {
    const row = ensureJobRow(job);
    const linkCell = row.querySelector('.job-id a');
    if (linkCell) {
      linkCell.textContent = job.id;
      linkCell.href = `/status/${job.id}`;
    }
    const projectCell = row.querySelector('.job-project');
    if (projectCell) {
      projectCell.textContent = job.project_dir || '';
    }
    applyStateClass(row.querySelector('.job-state'), job.state || 'queued');
    const createdCell = row.querySelector('.job-created');
    if (createdCell) {
      createdCell.textContent = job.created_at || '';
    }
    const startedCell = row.querySelector('.job-started');
    if (startedCell) {
      startedCell.textContent = job.started_at || '';
    }
    const finishedCell = row.querySelector('.job-finished');
    if (finishedCell) {
      finishedCell.textContent = job.finished_at || '';
    }
    const messageCell = row.querySelector('.job-message');
    if (messageCell) {
      messageCell.textContent = job.message || '';
    }
  }

  function isTerminal(state) {
    return state === 'done' || state === 'failed';
  }

  function stopPolling(jobId) {
    const intervalId = pollers.get(jobId);
    if (intervalId) {
      clearInterval(intervalId);
      pollers.delete(jobId);
    }
  }

  function setRunButtonsState(isRunning) {
    const globalRunBtn = document.getElementById('global-run-model-btn');
    const runFormBtn = document.querySelector('#run-form button[type="submit"]');

    [globalRunBtn, runFormBtn].forEach(btn => {
      if (btn) {
        btn.disabled = isRunning;
        if (isRunning) {
          btn.dataset.originalText = btn.textContent;
          btn.innerHTML = '⏳ Running...';
          btn.style.opacity = '0.7';
          btn.style.cursor = 'wait';
        } else {
          btn.innerHTML = btn.dataset.originalText || '▶ Run Model';
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
        }
      }
    });
  }

  function showSuccessNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
      z-index: 10000;
      font-weight: 600;
      animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }

  function checkRunningJobsForPortfolio() {
    // Check if any jobs are still running for the current portfolio
    const rows = jobsTableBody.querySelectorAll('tr');
    let hasRunningJob = false;

    rows.forEach(row => {
      const state = row.querySelector('.job-state');
      const portfolio = row.querySelector('.job-project');

      if (state && portfolio &&
          portfolio.textContent.trim() === selectedPortfolio &&
          !isTerminal(state.textContent.trim())) {
        hasRunningJob = true;
      }
    });

    setRunButtonsState(hasRunningJob);
  }

  function pollStatus(jobId, statusUrl) {
    if (!jobId || pollers.has(jobId)) {
      return;
    }
    const url = statusUrl || `/status/${jobId}`;

    const fetchStatus = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          stopPolling(jobId);
          setStatus(`❌ Failed to fetch status for job ${jobId}: ${response.status}`);
          checkRunningJobsForPortfolio();
          return;
        }
        const job = await response.json();
        updateJobRow(job);

        // Update status message based on job state
        if (job.state === 'running' && job.project_dir === selectedPortfolio) {
          setStatus(`⏳ Model is running for ${job.project_dir}... (Job ${job.id})`);
          setRunButtonsState(true);
        } else if (job.state === 'queued' && job.project_dir === selectedPortfolio) {
          setStatus(`⏱️ Job ${job.id} is queued for ${job.project_dir}...`);
          setRunButtonsState(true);
        }

        if (isTerminal(job.state)) {
          stopPolling(jobId);

          if (job.state === 'done') {
            setStatus(`✅ Model completed successfully for ${job.project_dir}! (Job ${job.id})`);

            if (job.project_dir && job.project_dir === selectedPortfolio) {
              showSuccessNotification(`✅ Results ready! Click the Results tab to view.`);

              // Clear caches so results reload fresh
              cachedTimelineData = null;
              cachedTimelinePortfolio = null;
              cachedResourceAllocationData = null;
              cachedResourceAllocationPortfolio = null;
              cachedUnallocatedHtml = null;
              cachedUnallocatedPortfolio = null;

              // Add a badge to the Results tab to indicate new results
              const resultsTab = document.querySelector('.tab[data-tab="results"]');
              if (resultsTab && !resultsTab.querySelector('.results-badge')) {
                const badge = document.createElement('span');
                badge.className = 'results-badge';
                badge.textContent = '●';
                badge.style.cssText = `
                  color: #10b981;
                  margin-left: 0.5rem;
                  font-size: 1rem;
                  animation: pulse 2s infinite;
                `;
                resultsTab.appendChild(badge);
              }

              // If already on Results tab, reload the active subtab
              const activeTab = document.querySelector('.tab.active');
              if (activeTab && activeTab.dataset.tab === 'results') {
                const activeSubtab = document.querySelector('#results .subtab.active');
                if (activeSubtab) {
                  const subtabName = activeSubtab.dataset.subtab;
                  if (subtabName === 'projects-timeline') {
                    loadProjectsTimeline({ forceReload: true });
                  } else if (subtabName === 'projects-unallocated') {
                    loadUnallocatedProjects({ forceReload: true });
                  } else if (subtabName === 'people-allocation') {
                    loadResourceAllocation();
                  }
                }
              }
            }
          } else {
            setStatus(`❌ Job ${job.id} failed. Return code: ${job.returncode ?? 'n/a'}. Message: ${job.message || 'None'}`);
          }

          // Check if any other jobs are still running for this portfolio
          checkRunningJobsForPortfolio();
        }
      } catch (err) {
        stopPolling(jobId);
        setStatus(`❌ Error polling job ${jobId}: ${err}`);
        checkRunningJobsForPortfolio();
      }
    };

    pollers.set(jobId, setInterval(fetchStatus, 2000));
    fetchStatus();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedPortfolio) {
      setStatus('⚠️ Please select a portfolio from the dropdown above.');
      return;
    }

    setStatus(`🚀 Starting model run for ${selectedPortfolio}...`);
    setRunButtonsState(true);

    try {
      const response = await fetch('/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ project_dir: selectedPortfolio }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload && payload.error ? `❌ ${payload.error}` : '❌ Failed to queue job.');
        setRunButtonsState(false);
        return;
      }
      setStatus(`⏱️ Job ${payload.job_id} queued for ${selectedPortfolio}...`);
      pollStatus(payload.job_id, payload.status_url);
    } catch (err) {
      setStatus(`❌ Unable to start job: ${err}`);
      setRunButtonsState(false);
    }
  }

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  const initialJobs = window.initialJobs || [];
  initialJobs.forEach((job) => {
    if (job && job.id) {
      updateJobRow(job);
      if (!isTerminal(job.state)) {
        pollStatus(job.id, `/status/${job.id}`);
      }
    }
  });
  // Check for running jobs after all initial jobs are loaded
  checkRunningJobsForPortfolio();
  delete window.initialJobs;

  refreshDirList();

  // Tab switching functionality
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active content
      tabContents.forEach(content => content.classList.remove('active'));
      const targetContent = document.getElementById(targetTab);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // Remove the results badge if switching to Results tab
      if (targetTab === 'results') {
        const badge = tab.querySelector('.results-badge');
        if (badge) {
          badge.remove();
        }

        // Load the currently active subtab
        const activeSubtab = document.querySelector('#results .subtab.active');
        if (activeSubtab) {
          const subtabName = activeSubtab.dataset.subtab;
          if (subtabName === 'projects-timeline') {
            loadProjectsTimeline();
          } else if (subtabName === 'projects-unallocated') {
            loadUnallocatedProjects();
          } else if (subtabName === 'people-allocation') {
            loadResourceAllocation();
          } else if (subtabName === 'people-recommendations') {
            loadRecommendations();
          }
        }
      }

      // Load data when switching tabs
      if (targetTab === 'files') {
        loadFiles();
      } else if (targetTab === 'people') {
        loadPeople();
        loadSkills();
      } else if (targetTab === 'projects') {
        loadProjects();
      } else if (targetTab === 'settings') {
        loadConfig();
        loadModellerSettings();
      } else if (targetTab === 'modelling') {
        loadModellerSettings();
      }
    });
  });

  // Subtab switching
  const subtabs = document.querySelectorAll('.subtab');
  subtabs.forEach(subtab => {
    subtab.addEventListener('click', () => {
      const targetSubtab = subtab.dataset.subtab;

      // Update active subtab
      const parentCard = subtab.closest('.card');
      parentCard.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));
      subtab.classList.add('active');

      // Update active content
      parentCard.querySelectorAll('.subtab-content').forEach(content => content.classList.remove('active'));
      const targetContent = document.getElementById(targetSubtab);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // Load data if needed
      if (targetSubtab === 'projects-input') {
        loadProjectsInput();
      } else if (targetSubtab === 'projects-programs') {
        loadPrograms();
      } else if (targetSubtab === 'projects-timeline') {
        loadProjectsTimeline();
      } else if (targetSubtab === 'projects-unallocated') {
        loadUnallocatedProjects();
      } else if (targetSubtab === 'people-staff') {
        loadPeople();
      } else if (targetSubtab === 'people-skills') {
        loadSkills();
      } else if (targetSubtab === 'people-allocation') {
        loadResourceAllocation();
      }
    });
  });

  // Load and display all files (input and output)
  async function loadFiles() {
    const container = document.getElementById('files-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading files...</div>';

    try {
      const response = await fetch(`/api/files/${selectedPortfolio}`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">Error loading file information</div>';
        return;
      }

      const fileData = await response.json();
      container.innerHTML = '';

      // Helper function to format date
      function formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString();
      }

      // Helper function to create file section
      function createFileSection(title, files, type) {
        const section = document.createElement('div');
        section.style.marginBottom = '2rem';

        const sectionTitle = document.createElement('h3');
        sectionTitle.textContent = title;
        sectionTitle.style.marginBottom = '1rem';
        sectionTitle.style.fontSize = '1.1rem';
        sectionTitle.style.color = 'var(--gray-800)';
        section.appendChild(sectionTitle);

        if (files.length === 0) {
          const emptyMsg = document.createElement('div');
          emptyMsg.style.color = 'var(--gray-600)';
          emptyMsg.style.fontSize = '0.875rem';
          emptyMsg.textContent = `No ${type} files found`;
          section.appendChild(emptyMsg);
          return section;
        }

        const fileList = document.createElement('div');
        fileList.className = 'file-list';

        for (const file of files) {
          const fileItem = document.createElement('div');
          fileItem.className = 'file-item';
          fileItem.style.background = 'var(--gray-50)';
          fileItem.style.border = '1px solid var(--gray-200)';
          fileItem.style.borderRadius = 'var(--border-radius)';
          fileItem.style.padding = '0.75rem';
          fileItem.style.marginBottom = '0.5rem';
          fileItem.style.display = 'flex';
          fileItem.style.justifyContent = 'space-between';
          fileItem.style.alignItems = 'center';
          fileItem.style.gap = '1rem';

          const fileLink = document.createElement('a');
          fileLink.className = 'file-link';
          fileLink.href = `/files/${selectedPortfolio}/${file.path}`;
          fileLink.textContent = file.path;
          fileLink.target = '_blank';
          fileLink.rel = 'noopener';
          fileLink.style.flex = '1';

          const fileInfo = document.createElement('div');
          fileInfo.style.display = 'flex';
          fileInfo.style.flexDirection = 'column';
          fileInfo.style.alignItems = 'flex-end';
          fileInfo.style.fontSize = '0.75rem';
          fileInfo.style.color = 'var(--gray-600)';
          fileInfo.style.whiteSpace = 'nowrap';

          const modifiedDate = document.createElement('div');
          modifiedDate.textContent = formatDate(file.modified);
          fileInfo.appendChild(modifiedDate);

          fileItem.appendChild(fileLink);
          fileItem.appendChild(fileInfo);
          fileList.appendChild(fileItem);
        }

        section.appendChild(fileList);
        return section;
      }

      // Input files section
      const inputSection = createFileSection('Input Files', fileData.input, 'input');
      container.appendChild(inputSection);

      // Output files section
      const outputSection = createFileSection('Output Files', fileData.output, 'output');
      container.appendChild(outputSection);

    } catch (err) {
      console.error('Error loading files:', err);
      container.innerHTML = '<div class="empty-state">Error loading files</div>';
    }
  }

  // Load and display resource allocation heatmap
  async function loadResourceAllocation() {
    const container = document.getElementById('resource-allocation-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading resource allocation data...</div>';

    try {
      const response = await fetch(`/files/${selectedPortfolio}/output/resource_capacity.csv`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">No resource capacity data available. Run the portfolio first to generate results.</div>';
        return;
      }

      const csvText = await response.text();
      const data = parseCSV(csvText);
      renderAllocationHeatmap(data, container);
    } catch (err) {
      console.error('Error loading resource allocation:', err);
      container.innerHTML = '<div class="empty-state">Error loading resource allocation data</div>';
    }
  }

  // Parse CSV text into array of objects
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  }

  function convertInlineMarkdown(text) {
    const escaped = escapeHtml(text || '');
    let html = escaped.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html;
  }

  function markdownToHtml(markdown) {
    if (!markdown) {
      return '';
    }
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const parts = [];
    let listType = null; // 'ul' or 'ol'

    const closeList = () => {
      if (listType === 'ul') {
        parts.push('</ul>');
      } else if (listType === 'ol') {
        parts.push('</ol>');
      }
      listType = null;
    };

    lines.forEach((rawLine) => {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        return;
      }
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        closeList();
        const level = Math.min(headingMatch[1].length, 6);
        const content = convertInlineMarkdown(headingMatch[2].trim());
        parts.push(`<h${level}>${content}</h${level}>`);
        return;
      }
      const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (orderedMatch) {
        if (listType !== 'ol') {
          closeList();
          listType = 'ol';
          parts.push('<ol>');
        }
        const content = convertInlineMarkdown(orderedMatch[2].trim());
        parts.push(`<li>${content}</li>`);
        return;
      }
      const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
      if (unorderedMatch) {
        if (listType !== 'ul') {
          closeList();
          listType = 'ul';
          parts.push('<ul>');
        }
        const content = convertInlineMarkdown(unorderedMatch[1].trim());
        parts.push(`<li>${content}</li>`);
        return;
      }
      closeList();
      const paragraph = convertInlineMarkdown(trimmed);
      parts.push(`<p>${paragraph}</p>`);
    });

    closeList();
    return parts.join('');
  }

  // Get heatmap color class based on allocation percentage
  function getAllocationClass(pct) {
    const percentage = parseFloat(pct) * 100;
    if (percentage > 100) return 'alloc-over';
    if (percentage >= 95) return 'alloc-100';
    if (percentage >= 85) return 'alloc-90';
    if (percentage >= 75) return 'alloc-80';
    if (percentage >= 65) return 'alloc-70';
    if (percentage >= 55) return 'alloc-60';
    if (percentage >= 45) return 'alloc-50';
    if (percentage >= 35) return 'alloc-40';
    if (percentage >= 25) return 'alloc-30';
    if (percentage >= 15) return 'alloc-20';
    if (percentage >= 5) return 'alloc-10';
    return 'alloc-0';
  }

  // Format percentage for display
  function formatPercent(pct) {
    const percentage = parseFloat(pct) * 100;
    return percentage > 0 ? Math.round(percentage) + '%' : '-';
  }

  // Render the allocation heatmap
  // Store original allocation data for editing
  let allocationData = [];
  const allocationChanges = new Map(); // Track changes: "person|project|month" -> new value

  function renderAllocationHeatmap(data, container) {
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state">No allocation data found</div>';
      return;
    }

    // Store data for editing
    allocationData = data;

    // First pass: identify each person's primary role(s)
    const personRoles = new Map();
    data.forEach(row => {
      const person = row.person;
      const role = row.role;
      if (role && role.trim()) {
        if (!personRoles.has(person)) {
          personRoles.set(person, new Set());
        }
        personRoles.get(person).add(role);
      }
    });

    // Group data by role, then person, then project
    const rolesMap = new Map();
    const monthsSet = new Set();

    data.forEach(row => {
      const person = row.person;
      const month = row.month;
      const projectName = row.project_name;
      const projectId = row.project_id;
      let role = row.role;
      const projectAlloc = parseFloat(row.project_alloc_pct) || 0;
      const totalPct = parseFloat(row.total_pct) || 0;

      monthsSet.add(month);

      // If role is empty (KTLO case), use person's primary role(s)
      if (!role || !role.trim()) {
        const roles = personRoles.get(person);
        if (roles && roles.size > 0) {
          // Use the first role (they might have multiple)
          role = Array.from(roles)[0];
        } else {
          role = 'Unknown';
        }
      }

      // Initialize role if not exists
      if (!rolesMap.has(role)) {
        rolesMap.set(role, {
          name: role,
          people: new Map(),
          months: new Map()
        });
      }

      const roleData = rolesMap.get(role);

      // Initialize person if not exists
      if (!roleData.people.has(person)) {
        roleData.people.set(person, {
          name: person,
          role: role,
          months: new Map(),
          projects: new Map()
        });
      }

      const personData = roleData.people.get(person);

      // Track total allocation per month for person
      if (!personData.months.has(month)) {
        personData.months.set(month, totalPct);
      }

      // Track project allocations
      const projectKey = `${month}:${projectName}`;
      if (!personData.projects.has(projectKey)) {
        personData.projects.set(projectKey, {
          month,
          projectName,
          projectId,
          role,
          allocation: projectAlloc
        });
      }
    });

    // Sort months
    const months = Array.from(monthsSet).sort();

    // Second pass: Calculate role-level aggregations correctly
    // Average allocation across ALL people in the role (including those with 0%)
    rolesMap.forEach(roleData => {
      const totalPeopleInRole = roleData.people.size;

      // For each month, sum allocations and divide by total people
      months.forEach(month => {
        let totalAlloc = 0;

        roleData.people.forEach(personData => {
          // Get this person's allocation for this month (0 if not present)
          const personAlloc = personData.months.get(month) || 0;
          totalAlloc += personAlloc;
        });

        // Calculate average across all people in the role
        const avgAlloc = totalPeopleInRole > 0 ? totalAlloc / totalPeopleInRole : 0;
        roleData.months.set(month, avgAlloc);
      });
    });

    // Sort roles (BA, Planner, Dev, then others)
    const roleOrder = ['BA', 'Planner', 'Dev'];
    const roles = Array.from(rolesMap.values()).sort((a, b) => {
      const aIndex = roleOrder.indexOf(a.name);
      const bIndex = roleOrder.indexOf(b.name);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    // Build HTML table
    let html = '<div class="table-container"><table class="allocation-table">';

    // Header row
    html += '<thead><tr>';
    html += '<th class="resource-name">Resource</th>';
    months.forEach(month => {
      html += `<th>${month}</th>`;
    });
    html += '</tr></thead>';

    // Body rows - three level hierarchy
    html += '<tbody>';

    roles.forEach((role, roleIndex) => {
      // Role-level row (top level)
      html += `<tr class="role-row" data-role="${role.name}">`;
      html += `<td class="resource-name" data-role-index="${roleIndex}">`;
      html += `<span class="expand-icon">▶</span>${role.name}`;
      html += '</td>';

      months.forEach(month => {
        const roleAlloc = role.months.get(month) || 0;
        const colorClass = getAllocationClass(roleAlloc);
        html += '<td>';
        html += `<div class="allocation-cell ${colorClass}">${formatPercent(roleAlloc)}</div>`;
        html += '</td>';
      });

      html += '</tr>';

      // Person-level rows (second level, initially hidden)
      const people = Array.from(role.people.values()).sort((a, b) => a.name.localeCompare(b.name));

      people.forEach((person, personIndex) => {
        html += `<tr class="person-row" data-role-child="${role.name}" data-person="${person.name}" style="display: none;">`;
        html += `<td class="resource-name" data-person-index="${roleIndex}-${personIndex}">`;
        html += `<span class="expand-icon">▶</span>${person.name}`;
        html += '</td>';

        months.forEach(month => {
          const totalPct = person.months.get(month) || 0;
          const colorClass = getAllocationClass(totalPct);
          html += '<td>';
          html += `<div class="allocation-cell ${colorClass}">${formatPercent(totalPct)}</div>`;
          html += '</td>';
        });

        html += '</tr>';

        // Project-level rows (third level, initially hidden)
        const allProjects = Array.from(person.projects.values());
        const uniqueProjects = new Map();

        allProjects.forEach(proj => {
          const key = proj.projectName;
          if (!uniqueProjects.has(key)) {
            uniqueProjects.set(key, []);
          }
          uniqueProjects.get(key).push(proj);
        });

        uniqueProjects.forEach((projMonths, projectName) => {
          html += `<tr class="detail-row" data-person-child="${person.name}" style="display: none;">`;
          const isKTLO = projectName === 'KTLO';
          html += `<td class="project-name ${isKTLO ? 'project-ktlo' : ''}">`;
          if (isKTLO) {
            html += 'KTLO';
          } else {
            const projectId = projMonths[0].projectId;
            html += `${projectId ? projectId + ' - ' : ''}${projectName}`;
          }
          html += '</td>';

          months.forEach(month => {
            const proj = projMonths.find(p => p.month === month);
            const alloc = proj ? proj.allocation : 0;
            const colorClass = getAllocationClass(alloc);
            const dataKey = `${person.name}|${projectName}|${month}`;
            html += '<td>';
            html += `<div class="allocation-cell editable-allocation ${colorClass}"
                          contenteditable="true"
                          data-person="${person.name}"
                          data-project="${projectName}"
                          data-month="${month}"
                          data-original="${alloc}">${formatPercent(alloc)}</div>`;
            html += '</td>';
          });

          html += '</tr>';
        });
      });
    });

    html += '</tbody></table></div>';

    // Add legend
    html += '<div class="allocation-legend">';
    html += '<div class="legend-item"><div class="legend-color alloc-0"></div><span>0-5%</span></div>';
    html += '<div class="legend-item"><div class="legend-color alloc-20"></div><span>15-25%</span></div>';
    html += '<div class="legend-item"><div class="legend-color alloc-40"></div><span>35-45%</span></div>';
    html += '<div class="legend-item"><div class="legend-color alloc-60"></div><span>55-65%</span></div>';
    html += '<div class="legend-item"><div class="legend-color alloc-80"></div><span>75-85%</span></div>';
    html += '<div class="legend-item"><div class="legend-color alloc-100"></div><span>95-100%</span></div>';
    html += '<div class="legend-item"><div class="legend-color alloc-over"></div><span>&gt;100%</span></div>';
    html += '</div>';

    // Add edit controls
    html += '<div class="edit-controls" style="margin-top: 16px; display: none;">';
    html += '<button id="save-allocation-btn" class="btn btn-primary">Save Changes</button>';
    html += '<button id="discard-allocation-btn" class="btn btn-secondary" style="margin-left: 8px;">Discard Changes</button>';
    html += '<span id="allocation-changes-count" style="margin-left: 16px; color: var(--blue-600);"></span>';
    html += '</div>';

    // Add metadata banner at the top
    createResultsMetadata().then(metadataHtml => {
      if (metadataHtml) {
        container.innerHTML = metadataHtml + html;
        attachAllocationEventHandlers(container);
      } else {
        container.innerHTML = html;
        attachAllocationEventHandlers(container);
      }
    }).catch(() => {
      container.innerHTML = html;
      attachAllocationEventHandlers(container);
    });
  }

  function attachAllocationEventHandlers(container) {
    // Add click handlers for role-level rows (top level)
    const roleNames = container.querySelectorAll('.role-row .resource-name[data-role-index]');
    roleNames.forEach(nameCell => {
      nameCell.addEventListener('click', () => {
        const roleName = nameCell.closest('tr').dataset.role;
        const personRows = container.querySelectorAll(`.person-row[data-role-child="${roleName}"]`);
        const isExpanded = nameCell.classList.contains('expanded');

        if (isExpanded) {
          // Collapse role
          nameCell.classList.remove('expanded');
          personRows.forEach(row => {
            row.style.display = 'none';
            // Also collapse any expanded people under this role
            const personNameCell = row.querySelector('.resource-name[data-person-index]');
            if (personNameCell && personNameCell.classList.contains('expanded')) {
              personNameCell.classList.remove('expanded');
              const personName = row.dataset.person;
              const projectRows = container.querySelectorAll(`.detail-row[data-person-child="${personName}"]`);
              projectRows.forEach(projRow => projRow.style.display = 'none');
            }
          });
        } else {
          // Expand role
          nameCell.classList.add('expanded');
          personRows.forEach(row => row.style.display = '');
        }
      });
    });

    // Add click handlers for person-level rows (second level)
    const personNames = container.querySelectorAll('.person-row .resource-name[data-person-index]');
    personNames.forEach(nameCell => {
      nameCell.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent role row click
        const personName = nameCell.closest('tr').dataset.person;
        const detailRows = container.querySelectorAll(`.detail-row[data-person-child="${personName}"]`);
        const isExpanded = nameCell.classList.contains('expanded');

        if (isExpanded) {
          nameCell.classList.remove('expanded');
          detailRows.forEach(row => row.style.display = 'none');
        } else {
          nameCell.classList.add('expanded');
          detailRows.forEach(row => row.style.display = '');
        }
      });
    });

    // Add handlers for editable allocation cells
    const editableCells = container.querySelectorAll('.editable-allocation');
    editableCells.forEach(cell => {
      // When user starts editing, convert percentage to decimal
      cell.addEventListener('focus', function() {
        const text = this.textContent.trim();
        if (text === '-') {
          this.textContent = '0';
        } else {
          // Remove % sign and convert to decimal (e.g., "25%" -> "0.25")
          const pct = parseFloat(text);
          if (!isNaN(pct)) {
            this.textContent = (pct / 100).toFixed(2);
          }
        }
        // Select all text for easy editing
        const range = document.createRange();
        range.selectNodeContents(this);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });

      // When user finishes editing, validate and save
      cell.addEventListener('blur', function() {
        let value = parseFloat(this.textContent.trim());

        // Validate input
        if (isNaN(value) || value < 0) {
          value = 0;
        }
        // Allow values over 1.0 (100%) for overallocation
        if (value > 10) {
          // If user entered a percentage (e.g., 25 instead of 0.25), convert it
          value = value / 100;
        }

        // Store the change
        const person = this.dataset.person;
        const project = this.dataset.project;
        const month = this.dataset.month;
        const original = parseFloat(this.dataset.original);
        const key = `${person}|${project}|${month}`;

        if (Math.abs(value - original) < 0.0001) {
          // No change, remove from changes map
          allocationChanges.delete(key);
          this.classList.remove('cell-modified');
        } else {
          // Track the change
          allocationChanges.set(key, {
            person,
            project,
            month,
            oldValue: original,
            newValue: value
          });
          this.classList.add('cell-modified');
        }

        // Update the display to percentage format
        this.textContent = formatPercent(value);

        // Update the cell color
        this.className = `allocation-cell editable-allocation ${getAllocationClass(value)}`;
        if (allocationChanges.has(key)) {
          this.classList.add('cell-modified');
        }

        // Update button visibility and change count
        updateEditControls();

        // Dynamically update person total and role average
        updateDynamicTotals(person, month);
      });

      // Prevent line breaks and limit input
      cell.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.blur();
        }
      });

      // Only allow numeric input and decimal point
      cell.addEventListener('input', function(e) {
        const text = this.textContent;
        // Remove non-numeric characters except decimal point
        const cleaned = text.replace(/[^0-9.]/g, '');
        if (cleaned !== text) {
          this.textContent = cleaned;
          // Move cursor to end
          const range = document.createRange();
          const selection = window.getSelection();
          range.selectNodeContents(this);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
    });

    // Add handlers for save/discard buttons
    const saveBtn = document.getElementById('save-allocation-btn');
    const discardBtn = document.getElementById('discard-allocation-btn');

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        await saveAllocationChanges();
      });
    }

    if (discardBtn) {
      discardBtn.addEventListener('click', () => {
        discardAllocationChanges();
      });
    }
  }

  // Update edit controls visibility and change count
  function updateEditControls() {
    const controls = document.querySelector('.edit-controls');
    const countSpan = document.getElementById('allocation-changes-count');

    if (controls) {
      if (allocationChanges.size > 0) {
        controls.style.display = 'block';
        if (countSpan) {
          countSpan.textContent = `${allocationChanges.size} change${allocationChanges.size > 1 ? 's' : ''} pending`;
        }
      } else {
        controls.style.display = 'none';
      }
    }
  }

  // Dynamically update person totals and role averages when a cell is edited
  function updateDynamicTotals(personName, month) {
    const container = document.getElementById('resource-allocation-container');
    if (!container) return;

    // Find the person's row
    const personRow = container.querySelector(`.person-row[data-person="${personName}"]`);
    if (!personRow) return;

    // Get the role name from the person row
    const roleName = personRow.dataset.roleChild;

    // Get all month headers to find the column index for this month
    const monthHeaders = Array.from(container.querySelectorAll('thead th'));
    let monthColumnIndex = -1;
    for (let i = 0; i < monthHeaders.length; i++) {
      if (monthHeaders[i].textContent.trim() === month) {
        monthColumnIndex = i;
        break;
      }
    }

    if (monthColumnIndex === -1) return;

    // Calculate new person total for this month
    // Find all detail rows for this person
    const detailRows = container.querySelectorAll(`.detail-row[data-person-child="${personName}"]`);
    let personTotal = 0;

    detailRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length > monthColumnIndex) {
        const cell = cells[monthColumnIndex];
        const allocationCell = cell.querySelector('.allocation-cell');
        if (allocationCell) {
          const cellPerson = allocationCell.dataset.person;
          const cellMonth = allocationCell.dataset.month;

          // Use changed value if it exists, otherwise use original
          const key = `${cellPerson}|${allocationCell.dataset.project}|${cellMonth}`;
          let value;
          if (allocationChanges.has(key)) {
            value = allocationChanges.get(key).newValue;
          } else {
            value = parseFloat(allocationCell.dataset.original) || 0;
          }
          personTotal += value;
        }
      }
    });

    // Update the person row cell for this month
    const personCells = personRow.querySelectorAll('td');
    if (personCells.length > monthColumnIndex) {
      const personCell = personCells[monthColumnIndex];
      const personAllocationCell = personCell.querySelector('.allocation-cell');
      if (personAllocationCell) {
        personAllocationCell.textContent = formatPercent(personTotal);
        personAllocationCell.className = `allocation-cell ${getAllocationClass(personTotal)}`;
      }
    }

    // Calculate new role average for this month
    // Find all person rows for this role
    const rolePersonRows = container.querySelectorAll(`.person-row[data-role-child="${roleName}"]`);
    let roleTotal = 0;
    let rolePersonCount = 0;

    rolePersonRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length > monthColumnIndex) {
        const cell = cells[monthColumnIndex];
        const allocationCell = cell.querySelector('.allocation-cell');
        if (allocationCell) {
          // Calculate this person's total (sum of their project allocations)
          const thisPersonName = row.dataset.person;
          const thisPersonDetailRows = container.querySelectorAll(`.detail-row[data-person-child="${thisPersonName}"]`);
          let thisPersonTotal = 0;

          thisPersonDetailRows.forEach(detailRow => {
            const detailCells = detailRow.querySelectorAll('td');
            if (detailCells.length > monthColumnIndex) {
              const detailCell = detailCells[monthColumnIndex];
              const detailAllocationCell = detailCell.querySelector('.allocation-cell');
              if (detailAllocationCell) {
                const cellPerson = detailAllocationCell.dataset.person;
                const cellMonth = detailAllocationCell.dataset.month;

                // Use changed value if it exists, otherwise use original
                const key = `${cellPerson}|${detailAllocationCell.dataset.project}|${cellMonth}`;
                let value;
                if (allocationChanges.has(key)) {
                  value = allocationChanges.get(key).newValue;
                } else {
                  value = parseFloat(detailAllocationCell.dataset.original) || 0;
                }
                thisPersonTotal += value;
              }
            }
          });

          roleTotal += thisPersonTotal;
          rolePersonCount++;
        }
      }
    });

    const roleAverage = rolePersonCount > 0 ? roleTotal / rolePersonCount : 0;

    // Update the role row cell for this month
    const roleRow = container.querySelector(`.role-row[data-role="${roleName}"]`);
    if (roleRow) {
      const roleCells = roleRow.querySelectorAll('td');
      if (roleCells.length > monthColumnIndex) {
        const roleCell = roleCells[monthColumnIndex];
        const roleAllocationCell = roleCell.querySelector('.allocation-cell');
        if (roleAllocationCell) {
          roleAllocationCell.textContent = formatPercent(roleAverage);
          roleAllocationCell.className = `allocation-cell ${getAllocationClass(roleAverage)}`;
        }
      }
    }
  }

  // Discard allocation changes
  function discardAllocationChanges() {
    allocationChanges.clear();

    // Reload the allocation table to reset all values
    loadResourceAllocation();
  }

  // Save allocation changes to backend
  async function saveAllocationChanges() {
    if (allocationChanges.size === 0) {
      return;
    }

    const saveBtn = document.getElementById('save-allocation-btn');
    const discardBtn = document.getElementById('discard-allocation-btn');

    if (saveBtn) saveBtn.disabled = true;
    if (discardBtn) discardBtn.disabled = true;

    try {
      // Convert changes map to array for sending to backend
      const changes = Array.from(allocationChanges.values());

      const response = await fetch(`/api/allocation/${selectedPortfolio}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ changes })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save allocation changes');
      }

      const result = await response.json();

      // Clear changes and reload
      allocationChanges.clear();
      await loadResourceAllocation();

      showNotification('Allocation changes saved successfully', 'success');
    } catch (error) {
      console.error('Error saving allocation changes:', error);
      showNotification(`Error saving changes: ${error.message}`, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (discardBtn) discardBtn.disabled = false;
    }
  }

  // People Management
  let peopleData = [];
  let editingPersonIndex = -1;

  // Load people data
  async function loadPeople() {
    const container = document.getElementById('people-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading people...</div>';

    try {
      const response = await fetch(`/api/people/${selectedPortfolio}`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">No people data found. Click "Add Person" to create your first person.</div>';
        peopleData = [];
        return;
      }

      peopleData = await response.json();
      renderPeopleCards();
    } catch (err) {
      console.error('Error loading people:', err);
      container.innerHTML = '<div class="empty-state">Error loading people data</div>';
    }
  }

  // Render people cards grouped by role
  function renderPeopleCards() {
    const container = document.getElementById('people-container');
    if (!container) return;

    if (peopleData.length === 0) {
      container.innerHTML = '<div class="empty-state">No people found. Click "Add Person" to get started.</div>';
      return;
    }

    // Group people by role
    const roleGroups = {
      'BA': [],
      'Planner': [],
      'Dev': []
    };

    peopleData.forEach((person, index) => {
      const roles = Array.isArray(person.roles) ? person.roles : [];
      roles.forEach(role => {
        if (roleGroups[role]) {
          roleGroups[role].push({ ...person, index });
        }
      });
    });

    let html = '';

    // Render each role group
    Object.entries(roleGroups).forEach(([role, people]) => {
      const roleId = role.toLowerCase();
      const count = people.length;

      html += `<div class="role-group">`;
      html += `<div class="role-group-header" onclick="toggleRoleGroup('${roleId}')">`;
      html += `<span class="expand-icon" id="${roleId}-icon">▼</span>`;
      html += `<h3>${role} <span class="role-count">(${count})</span></h3>`;
      html += `</div>`;
      html += `<div class="people-grid" id="${roleId}-people">`;

      if (people.length === 0) {
        html += `<div class="empty-state" style="padding: 1rem;">No ${role} resources</div>`;
      } else {
        people.forEach(person => {
          const skillsets = Array.isArray(person.skillsets) ? person.skillsets : [];
          const isActive = person.active !== false;
          const index = person.index;

          html += `<div class="person-card">`;
          html += `<div class="person-header">`;
          html += `<div>`;
          html += `<div class="person-name">${person.person || 'Unnamed'}</div>`;
          html += `<div class="person-roles">`;

          // Show all roles for this person
          const allRoles = Array.isArray(person.roles) ? person.roles : [];
          allRoles.forEach(r => {
            html += `<span class="role-badge">${r}</span>`;
          });
          html += `<span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">${isActive ? 'Active' : 'Inactive'}</span>`;
          html += `</div>`;
          html += `</div>`;
          html += `<div class="person-actions">`;
          html += `<button class="btn-icon" onclick="editPerson(${index})" title="Edit">✏️</button>`;
          html += `<button class="btn-icon delete" onclick="deletePerson(${index})" title="Delete">🗑️</button>`;
          html += `</div>`;
          html += `</div>`;

          if (skillsets.length > 0) {
            html += `<div class="person-detail">`;
            html += `<strong>Skills:</strong> `;
            skillsets.forEach(skill => {
              html += `<span class="skillset-tag">${skill}</span>`;
            });
            html += `</div>`;
          }

          if (person.start_date) {
            html += `<div class="person-detail"><strong>Start:</strong> ${person.start_date}</div>`;
          }
          if (person.end_date) {
            html += `<div class="person-detail"><strong>End:</strong> ${person.end_date}</div>`;
          }

          if (person.notes) {
            html += `<div class="person-detail"><strong>Notes:</strong> ${person.notes}</div>`;
          }

          html += `</div>`;
        });
      }

      html += `</div>`; // End people-grid
      html += `</div>`; // End role-group
    });

    container.innerHTML = html;
  }

  // Toggle role group visibility
  window.toggleRoleGroup = function(roleId) {
    const peopleGrid = document.getElementById(`${roleId}-people`);
    const icon = document.getElementById(`${roleId}-icon`);

    if (peopleGrid && icon) {
      if (peopleGrid.style.display === 'none') {
        peopleGrid.style.display = 'grid';
        icon.textContent = '▼';
      } else {
        peopleGrid.style.display = 'none';
        icon.textContent = '▶';
      }
    }
  };

  // Add person button handler
  const addPersonBtn = document.getElementById('add-person-btn');
  if (addPersonBtn) {
    addPersonBtn.addEventListener('click', async () => {
      editingPersonIndex = -1;
      await ensureProgramsLoaded(); // Load programs for autocomplete
      openPersonModal();
    });
  }

  // Open modal for adding/editing person
  window.openPersonModal = async function (person = null) {
    await ensureProgramsLoaded(); // Ensure programs are loaded for autocomplete

    const modal = document.getElementById('person-modal');
    const modalTitle = document.getElementById('modal-title');
    const form = document.getElementById('person-form');

    if (!modal || !form) return;

    // Reset form
    form.reset();
    document.querySelectorAll('input[name="role"]').forEach(cb => cb.checked = false);

    if (person) {
      // Edit mode
      modalTitle.textContent = 'Edit Person';
      document.getElementById('person-name').value = person.person || '';

      if (Array.isArray(person.roles)) {
        person.roles.forEach(role => {
          const checkbox = form.querySelector(`input[name="role"][value="${role}"]`);
          if (checkbox) checkbox.checked = true;
        });
      }

      document.getElementById('person-active').checked = person.active !== false;
      document.getElementById('person-start-date').value = person.start_date || '';
      document.getElementById('person-end-date').value = person.end_date || '';
      document.getElementById('person-notes').value = person.notes || '';

      // Initialize tag inputs with skills and programs suggestions
      const skillSuggestions = skillsData.map(s => s.skill_id);
      const programSuggestions = programsData.map(p => p.name).filter(n => n);
      initializeTagInput('skillsets-container', person.skillsets || [], skillSuggestions);
      initializeTagInput('summaries-container', person.preferred_parent_summaries || [], programSuggestions);
    } else {
      // Add mode
      modalTitle.textContent = 'Add Person';
      document.getElementById('person-active').checked = true;
      const skillSuggestions = skillsData.map(s => s.skill_id);
      const programSuggestions = programsData.map(p => p.name).filter(n => n);
      initializeTagInput('skillsets-container', [], skillSuggestions);
      initializeTagInput('summaries-container', [], programSuggestions);
    }

    modal.classList.add('active');
  };

  window.editPerson = function (index) {
    editingPersonIndex = index;
    openPersonModal(peopleData[index]);
  };

  window.deletePerson = async function (index) {
    const person = peopleData[index];
    if (!confirm(`Are you sure you want to delete ${person.person}?`)) {
      return;
    }

    peopleData.splice(index, 1);
    await savePeopleData();
    renderPeopleCards();
  };

  window.closePersonModal = function () {
    const modal = document.getElementById('person-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  };

  // Tag input functionality
  function initializeTagInput(containerId, initialTags = [], suggestions = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.dataset.tags = JSON.stringify(initialTags);

    // Add existing tags
    initialTags.forEach(tag => {
      addTag(container, tag);
    });

    // Add input with autocomplete
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-input';
    input.placeholder = 'Type and press Enter';

    // Create datalist for autocomplete if suggestions provided
    if (suggestions.length > 0) {
      const datalistId = `${containerId}-suggestions`;
      input.setAttribute('list', datalistId);

      const datalist = document.createElement('datalist');
      datalist.id = datalistId;

      suggestions.forEach(suggestion => {
        const option = document.createElement('option');
        option.value = suggestion;
        datalist.appendChild(option);
      });

      container.appendChild(datalist);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value.trim();
        if (value) {
          addTag(container, value);
          input.value = '';
          updateTags(container);
        }
      }
    });

    container.appendChild(input);
  }

  function addTag(container, text) {
    const tagItem = document.createElement('div');
    tagItem.className = 'tag-item';

    const tagText = document.createElement('span');
    tagText.textContent = text;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'tag-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      tagItem.remove();
      updateTags(container);
    };

    tagItem.appendChild(tagText);
    tagItem.appendChild(removeBtn);

    // Insert before input
    const input = container.querySelector('.tag-input');
    if (input) {
      container.insertBefore(tagItem, input);
    } else {
      container.appendChild(tagItem);
    }
  }

  function updateTags(container) {
    const tags = [];
    container.querySelectorAll('.tag-item span:first-child').forEach(span => {
      tags.push(span.textContent);
    });
    container.dataset.tags = JSON.stringify(tags);
  }

  function getTagsFromContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    try {
      return JSON.parse(container.dataset.tags || '[]');
    } catch (e) {
      return [];
    }
  }

  // Form submission
  const personForm = document.getElementById('person-form');
  if (personForm) {
    personForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('person-name').value.trim();
      if (!name) {
        alert('Person name is required');
        return;
      }

      const roles = [];
      document.querySelectorAll('input[name="role"]:checked').forEach(cb => {
        roles.push(cb.value);
      });

      if (roles.length === 0) {
        alert('At least one role must be selected');
        return;
      }

      const personData = {
        person: name,
        roles: roles,
        active: document.getElementById('person-active').checked,
        start_date: document.getElementById('person-start-date').value || undefined,
        end_date: document.getElementById('person-end-date').value || undefined,
        skillsets: getTagsFromContainer('skillsets-container'),
        preferred_parent_summaries: getTagsFromContainer('summaries-container'),
        notes: document.getElementById('person-notes').value.trim()
      };

      // Remove undefined values
      Object.keys(personData).forEach(key => {
        if (personData[key] === undefined) {
          delete personData[key];
        }
      });

      if (editingPersonIndex >= 0) {
        // Update existing
        peopleData[editingPersonIndex] = personData;
      } else {
        // Add new
        peopleData.push(personData);
      }

      await savePeopleData();
      closePersonModal();
      renderPeopleCards();
    });
  }

  // Create Portfolio Modal Functions
  const createPortfolioBtn = document.getElementById('create-portfolio-btn');
  if (createPortfolioBtn) {
    createPortfolioBtn.addEventListener('click', () => {
      openCreatePortfolioModal();
    });
  }

  window.openCreatePortfolioModal = function () {
    const modal = document.getElementById('create-portfolio-modal');
    const form = document.getElementById('create-portfolio-form');

    if (!modal || !form) return;

    // Reset form
    form.reset();

    modal.classList.add('active');
  };

  window.closeCreatePortfolioModal = function () {
    const modal = document.getElementById('create-portfolio-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  };

  // Create Portfolio Form Submission
  const createPortfolioForm = document.getElementById('create-portfolio-form');
  if (createPortfolioForm) {
    createPortfolioForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const portfolioName = document.getElementById('new-portfolio-name').value.trim();
      if (!portfolioName) {
        alert('Portfolio name is required');
        return;
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(portfolioName)) {
        alert('Portfolio name can only contain letters, numbers, dashes, and underscores');
        return;
      }

      try {
        const response = await fetch('/api/portfolio/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: portfolioName })
        });

        const result = await response.json();

        if (response.ok) {
          alert(`Portfolio "${portfolioName}" created successfully!`);
          closeCreatePortfolioModal();

          // Refresh portfolio list
          await refreshDirList();

          // Select the newly created portfolio
          if (portfolioSelector) {
            portfolioSelector.value = portfolioName;
            selectedPortfolio = portfolioName;
            localStorage.setItem('selectedPortfolio', selectedPortfolio);
            handlePortfolioChange();
          }
        } else {
          alert(`Error creating portfolio: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error creating portfolio:', error);
        alert('Failed to create portfolio. Please try again.');
      }
    });
  }

  // Save people data to backend
  async function savePeopleData() {
    if (!selectedPortfolio) {
      alert('No portfolio selected');
      return;
    }

    try {
      const response = await fetch(`/api/people/${selectedPortfolio}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(peopleData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save');
      }

      console.log('People data saved successfully');
    } catch (err) {
      console.error('Error saving people:', err);
      alert('Error saving people data: ' + err.message);
    }
  }

  // Also refresh people when portfolio changes
  if (portfolioSelector) {
    const originalChangeHandler = portfolioSelector.onchange;
    portfolioSelector.addEventListener('change', () => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.tab === 'people') {
        loadPeople();
        loadSkills();
      } else if (activeTab && activeTab.dataset.tab === 'projects') {
        loadProjects();
      } else if (activeTab && activeTab.dataset.tab === 'settings') {
        loadConfig();
        loadModellerSettings();
      } else if (activeTab && activeTab.dataset.tab === 'modelling') {
        loadModellerSettings();
      }
    });
  }

  // Skills Management
  let skillsData = [];
  let editingSkillIndex = -1;

  // Load skills data
  async function loadSkills() {
    const container = document.getElementById('skills-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading skills...</div>';

    try {
      const response = await fetch(`/api/skills/${selectedPortfolio}`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">No skills data found. Click "Add Skill" to create your first skill.</div>';
        skillsData = [];
        return;
      }

      skillsData = await response.json();
      renderSkillsTable();
    } catch (err) {
      console.error('Error loading skills:', err);
      container.innerHTML = '<div class="empty-state">Error loading skills data</div>';
    }
  }

  // Render skills table
  function renderSkillsTable() {
    const container = document.getElementById('skills-container');
    if (!container) return;

    if (skillsData.length === 0) {
      container.innerHTML = '<div class="empty-state">No skills found. Click "Add Skill" to get started.</div>';
      return;
    }

    // Group skills by category
    const categories = {};
    skillsData.forEach((skill, index) => {
      const category = skill.category || 'General';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push({ ...skill, index });
    });

    let html = '<div class="table-container">';

    // Render each category
    Object.entries(categories).sort().forEach(([category, skills]) => {
      html += `<div style="margin-bottom: 2rem;">`;
      html += `<h4 style="margin-bottom: 0.5rem; color: var(--gray-700);">${category} (${skills.length})</h4>`;
      html += `<table style="width: 100%;">`;
      html += `<thead><tr>`;
      html += `<th style="text-align: left; width: 20%;">Skill ID</th>`;
      html += `<th style="text-align: left; width: 20%;">Name</th>`;
      html += `<th style="text-align: left; width: 40%;">Description</th>`;
      html += `<th style="text-align: right; width: 20%;">Actions</th>`;
      html += `</tr></thead>`;
      html += `<tbody>`;

      skills.forEach(skill => {
        html += `<tr>`;
        html += `<td><code>${skill.skill_id}</code></td>`;
        html += `<td>${skill.name || ''}</td>`;
        html += `<td style="color: var(--gray-600); font-size: 0.875rem;">${skill.description || ''}</td>`;
        html += `<td style="text-align: right;">`;
        html += `<button class="btn-icon" onclick="editSkill(${skill.index})" title="Edit">✏️</button>`;
        html += `<button class="btn-icon delete" onclick="deleteSkill(${skill.index})" title="Delete">🗑️</button>`;
        html += `</td>`;
        html += `</tr>`;
      });

      html += `</tbody></table>`;
      html += `</div>`;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // Add skill button handler
  const addSkillBtn = document.getElementById('add-skill-btn');
  if (addSkillBtn) {
    addSkillBtn.addEventListener('click', () => {
      editingSkillIndex = -1;
      openSkillModal();
    });
  }

  // Open modal for adding/editing skill
  window.openSkillModal = function (skill = null) {
    const modal = document.getElementById('skill-modal');
    const modalTitle = document.getElementById('skill-modal-title');
    const form = document.getElementById('skill-form');

    if (!modal || !form) return;

    // Reset form
    form.reset();

    if (skill) {
      // Edit mode
      modalTitle.textContent = 'Edit Skill';
      document.getElementById('skill-id').value = skill.skill_id || '';
      document.getElementById('skill-id').readOnly = true; // Don't allow changing ID
      document.getElementById('skill-name').value = skill.name || '';
      document.getElementById('skill-category').value = skill.category || '';
      document.getElementById('skill-description').value = skill.description || '';
    } else {
      // Add mode
      modalTitle.textContent = 'Add Skill';
      document.getElementById('skill-id').readOnly = false;
    }

    modal.classList.add('active');
  };

  window.editSkill = function (index) {
    editingSkillIndex = index;
    openSkillModal(skillsData[index]);
  };

  window.deleteSkill = async function (index) {
    const skill = skillsData[index];
    if (!confirm(`Are you sure you want to delete the skill "${skill.name}"?`)) {
      return;
    }

    skillsData.splice(index, 1);
    await saveSkillsData();
    renderSkillsTable();
  };

  window.closeSkillModal = function () {
    const modal = document.getElementById('skill-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  };

  // Skill form submission
  const skillForm = document.getElementById('skill-form');
  if (skillForm) {
    skillForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const skillId = document.getElementById('skill-id').value.trim();
      const name = document.getElementById('skill-name').value.trim();
      const category = document.getElementById('skill-category').value;
      const description = document.getElementById('skill-description').value.trim();

      if (!skillId || !name || !category) {
        alert('Skill ID, Name, and Category are required');
        return;
      }

      // Check for duplicate skill_id when adding new
      if (editingSkillIndex < 0) {
        const duplicate = skillsData.find(s => s.skill_id === skillId);
        if (duplicate) {
          alert('A skill with this ID already exists');
          return;
        }
      }

      const skillData = {
        skill_id: skillId,
        name: name,
        category: category,
        description: description
      };

      if (editingSkillIndex >= 0) {
        // Update existing
        skillsData[editingSkillIndex] = skillData;
      } else {
        // Add new
        skillsData.push(skillData);
      }

      await saveSkillsData();
      closeSkillModal();
      renderSkillsTable();
    });
  }

  // Save skills data to backend
  async function saveSkillsData() {
    if (!selectedPortfolio) {
      alert('No portfolio selected');
      return;
    }

    try {
      const response = await fetch(`/api/skills/${selectedPortfolio}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(skillsData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save');
      }

      console.log('Skills data saved successfully');
    } catch (err) {
      console.error('Error saving skills:', err);
      alert('Error saving skills data: ' + err.message);
    }
  }

  // Programs Management
  function cloneProgramsData(data) {
    return JSON.parse(JSON.stringify(data || []));
  }

  function hasUnsavedProgramChanges() {
    if (programsData.length !== originalProgramsData.length) {
      return true;
    }
    for (let i = 0; i < programsData.length; i += 1) {
      const current = programsData[i] || {};
      const original = originalProgramsData[i] || {};
      const currentName = (current.name || '').trim();
      const originalName = (original.name || '').trim();
      if (currentName !== originalName) {
        return true;
      }
      const currentColor = sanitizeProgramColor(current.color || '', currentName || `Program ${i + 1}`, i);
      const originalColor = sanitizeProgramColor(original.color || '', originalName || `Program ${i + 1}`, i);
      if (currentColor !== originalColor) {
        return true;
      }
    }
    return false;
  }

  async function ensureProgramsLoaded(force = false) {
    if (!selectedPortfolio) {
      resetProgramsState();
      return false;
    }
    if (!force && programsLoadedPortfolio === selectedPortfolio) {
      return true;
    }
    if (!force && programsDirty) {
      rebuildProgramColorMap();
      return true;
    }
    try {
      const response = await fetch(`/api/programs/${selectedPortfolio}`);
      if (!response.ok) {
        if (response.status === 404) {
          programsData = [];
          originalProgramsData = [];
          programsLoadedPortfolio = selectedPortfolio;
          rebuildProgramColorMap();
          updateProgramsUnsavedIndicator();
          return true;
        }
        throw new Error(`Request failed with status ${response.status}`);
      }
      const payload = await response.json();
      const normalized = Array.isArray(payload)
        ? payload.map((row, index) => normalizeProgramRow(row, index))
        : [];
      programsData = normalized;
      originalProgramsData = cloneProgramsData(programsData);
      programsLoadedPortfolio = selectedPortfolio;
      rebuildProgramColorMap();
      updateProgramsUnsavedIndicator();
      return true;
    } catch (err) {
      console.error('Error loading programs:', err);
      return false;
    }
  }

  function updateProgramsUnsavedIndicator() {
    const indicator = document.getElementById('unsaved-programs-indicator');
    const discardBtn = document.getElementById('discard-programs-btn');
    const hasChanges = hasUnsavedProgramChanges();
    programsDirty = hasChanges;
    if (indicator) {
      if (hasChanges) {
        indicator.classList.add('visible');
      } else {
        indicator.classList.remove('visible');
      }
    }
    if (discardBtn) {
      discardBtn.style.display = hasChanges ? 'inline-block' : 'none';
    }
  }

  function renderProgramsTable() {
    const container = document.getElementById('programs-container');
    if (!container) {
      return;
    }
    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio to view programs</div>';
      return;
    }

    rebuildProgramColorMap();

    if (programsData.length === 0) {
      container.innerHTML = '<div class="empty-state">No programs found. Click "Add Program" to create your first program.</div>';
      updateProgramsUnsavedIndicator();
      return;
    }

    let html = '<div class="people-grid" style="gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">';

    programsData.forEach((program, index) => {
      const nameValue = program.name || 'Unnamed Program';
      const colorValue = sanitizeProgramColor(program.color || '', program.name || `Program ${index + 1}`, index);
      const badgeBorder = shadeColor(colorValue, -0.25);
      const rowBackground = getProgramBackground(colorValue);

      html += `<div class="person-card" style="border-left: 4px solid ${colorValue};">`;
      html += `<div class="person-header">`;
      html += `<div>`;
      html += `<div class="person-name">${escapeHtml(nameValue)}</div>`;
      html += `<div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">`;
      html += `<span style="display: inline-block; width: 30px; height: 30px; background: ${colorValue}; border: 2px solid ${badgeBorder}; border-radius: 4px;"></span>`;
      html += `<code style="font-size: 0.75rem; color: var(--gray-600);">${colorValue}</code>`;
      html += `</div>`;
      html += `</div>`;
      html += `<div class="person-actions">`;
      html += `<button class="btn-icon" onclick="editProgram(${index})" title="Edit">✏️</button>`;
      html += `<button class="btn-icon delete" onclick="deleteProgram(${index})" title="Delete">🗑️</button>`;
      html += `</div>`;
      html += `</div>`;
      html += `</div>`;
    });

    html += '</div>';
    container.innerHTML = html;

    updateProgramsUnsavedIndicator();
  }

  async function loadPrograms() {
    const container = document.getElementById('programs-container');
    const addBtn = document.getElementById('add-program-btn');
    const saveBtn = document.getElementById('save-programs-btn');

    if (!container) {
      return;
    }

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      if (addBtn) addBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
      updateProgramsUnsavedIndicator();
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading programs...</div>';
    if (addBtn) addBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';

    const loaded = await ensureProgramsLoaded();
    if (!loaded) {
      container.innerHTML = '<div class="empty-state">Error loading programs data</div>';
      return;
    }

    if (addBtn) addBtn.style.display = 'inline-block';
    if (saveBtn) saveBtn.style.display = 'inline-block';

    renderProgramsTable();
  }

  let editingProgramIndex = -1;

  window.openProgramModal = function (program = null) {
    const modal = document.getElementById('program-modal');
    const modalTitle = document.getElementById('program-modal-title');
    const form = document.getElementById('program-form');

    if (!modal || !form) return;

    // Reset form
    form.reset();

    if (program) {
      // Edit mode
      modalTitle.textContent = 'Edit Program';
      document.getElementById('program-name').value = program.name || '';
      const colorValue = sanitizeProgramColor(program.color || '', program.name || '', 0);
      document.getElementById('program-color').value = colorValue;
      document.getElementById('program-color-hex').value = colorValue;
    } else {
      // Add mode
      modalTitle.textContent = 'Add Program';
      const nextIndex = programsData.length;
      const defaultColor = PROGRAM_COLOR_PALETTE[nextIndex % PROGRAM_COLOR_PALETTE.length] || DEFAULT_PROGRAM_COLOR;
      document.getElementById('program-color').value = defaultColor;
      document.getElementById('program-color-hex').value = defaultColor;
    }

    modal.classList.add('active');
  };

  window.editProgram = function (index) {
    editingProgramIndex = index;
    openProgramModal(programsData[index]);
  };

  window.addProgram = function () {
    editingProgramIndex = -1;
    openProgramModal();
  };

  window.closeProgramModal = function () {
    const modal = document.getElementById('program-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  };

  // Program form submission
  const programForm = document.getElementById('program-form');
  if (programForm) {
    // Sync color picker with hex input
    const colorPicker = document.getElementById('program-color');
    const colorHex = document.getElementById('program-color-hex');

    if (colorPicker && colorHex) {
      colorPicker.addEventListener('input', (e) => {
        colorHex.value = e.target.value;
      });

      colorHex.addEventListener('input', (e) => {
        const value = e.target.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
          colorPicker.value = value;
        }
      });
    }

    programForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('program-name').value.trim();
      const color = document.getElementById('program-color').value;

      if (!name) {
        alert('Program name is required');
        return;
      }

      const programData = {
        name: name,
        color: color
      };

      if (editingProgramIndex >= 0) {
        // Update existing
        programsData[editingProgramIndex] = programData;
      } else {
        // Add new
        programsData.push(programData);
      }

      rebuildProgramColorMap();
      updateProgramsUnsavedIndicator();
      renderProgramsTable();
      refreshProjectVisuals();
      closeProgramModal();
    });
  }

  window.deleteProgram = function (index) {
    if (index < 0 || index >= programsData.length) {
      return;
    }
    const program = programsData[index];
    const name = program.name || 'this program';
    if (!window.confirm(`Are you sure you want to delete ${name}?`)) {
      return;
    }
    programsData.splice(index, 1);
    rebuildProgramColorMap();
    updateProgramsUnsavedIndicator();
    renderProgramsTable();
    refreshProjectVisuals();
  };

  window.discardProgramChanges = function () {
    if (!programsDirty) {
      return;
    }
    if (!window.confirm('Are you sure you want to discard all unsaved program changes?')) {
      return;
    }
    programsData = cloneProgramsData(originalProgramsData);
    rebuildProgramColorMap();
    updateProgramsUnsavedIndicator();
    renderProgramsTable();
    refreshProjectVisuals();
  };

  async function saveProgramsData() {
    if (!selectedPortfolio) {
      window.alert('No portfolio selected');
      return;
    }
    const saveBtn = document.getElementById('save-programs-btn');
    const originalLabel = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    try {
      const sanitized = programsData
        .map((program, index) => ({
          name: (program.name || '').trim(),
          color: sanitizeProgramColor(program.color || '', program.name || `Program ${index + 1}`, index)
        }))
        .filter((program) => program.name);

      const response = await fetch(`/api/programs/${selectedPortfolio}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sanitized)
      });

      if (!response.ok) {
        let errorMessage = 'Failed to save';
        try {
          const payload = await response.json();
          if (payload && payload.error) {
            errorMessage = payload.error;
          }
        } catch (parseErr) {
          errorMessage = `Failed to save (status ${response.status})`;
        }
        throw new Error(errorMessage);
      }

      programsData = cloneProgramsData(sanitized);
      originalProgramsData = cloneProgramsData(sanitized);
      programsLoadedPortfolio = selectedPortfolio;
      rebuildProgramColorMap();
      updateProgramsUnsavedIndicator();
      renderProgramsTable();
      refreshProjectVisuals();

      if (saveBtn) {
        saveBtn.textContent = '✓ Saved!';
        window.setTimeout(() => {
          saveBtn.textContent = originalLabel || 'Save Changes';
        }, 2000);
      }
    } catch (err) {
      console.error('Error saving programs:', err);
      window.alert(`Error saving programs data: ${err.message}`);
      if (saveBtn) {
        saveBtn.textContent = originalLabel || 'Save Changes';
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
      }
    }
  }

  const addProgramBtn = document.getElementById('add-program-btn');
  if (addProgramBtn) {
    addProgramBtn.addEventListener('click', () => {
      window.addProgram();
    });
  }

  const saveProgramsBtn = document.getElementById('save-programs-btn');
  if (saveProgramsBtn) {
    saveProgramsBtn.addEventListener('click', saveProgramsData);
  }

  const discardProgramsBtn = document.getElementById('discard-programs-btn');
  if (discardProgramsBtn) {
    discardProgramsBtn.addEventListener('click', () => {
      window.discardProgramChanges();
    });
  }

  // Config Management
  let configEventsBound = false;
  let previousPlanningEndValue = '';

  function encodeConfigPath(parts) {
    if (!Array.isArray(parts)) {
      return '';
    }
    return parts.map((part) => encodeURIComponent(part ?? '')).join('|');
  }

  function decodeConfigPath(pathValue) {
    if (!pathValue) {
      return null;
    }
    return pathValue.split('|').map((segment) => decodeURIComponent(segment));
  }

  function getConfigFieldElement(pathValue) {
    if (!pathValue) {
      return null;
    }
    const candidate = document.querySelectorAll('[data-config-path]');
    for (const el of candidate) {
      if (el.dataset && el.dataset.configPath === pathValue) {
        return el;
      }
    }
    return null;
  }

  function ensureConfigEventBindings() {
    if (configEventsBound) {
      return;
    }
    const container = document.getElementById('config-container');
    if (!container) {
      return;
    }
    container.addEventListener('input', onConfigInput);
    container.addEventListener('change', onConfigChange);
    container.addEventListener('click', onConfigClick);
    configEventsBound = true;
  }

  function setConfigError(pathValue, message, element) {
    if (pathValue) {
      configErrors[pathValue] = message;
    }
    if (element) {
      element.classList.add('input-error');
      element.title = message || '';
    }
  }

  function clearConfigError(pathValue, element) {
    if (pathValue) {
      delete configErrors[pathValue];
    }
    if (element) {
      element.classList.remove('input-error');
      element.removeAttribute('title');
    }
  }

  function applyConfigErrors() {
    Object.entries(configErrors).forEach(([field, message]) => {
      const el = getConfigFieldElement(field);
      if (el) {
        el.classList.add('input-error');
        el.title = message;
      }
    });
  }

  function parseConfigValue(rawValue, type, options = {}) {
    const result = { value: rawValue, error: null };
    switch (type) {
      case 'number':
      case 'float': {
        if (rawValue === '' || rawValue === null || rawValue === undefined) {
          result.value = null;
          return result;
        }
        const numberValue = Number(rawValue);
        if (!Number.isFinite(numberValue)) {
          result.error = 'Enter a valid number';
          return result;
        }
        result.value = numberValue;
        return result;
      }
      case 'int': {
        if (rawValue === '' || rawValue === null || rawValue === undefined) {
          result.value = null;
          return result;
        }
        const intValue = Number.parseInt(rawValue, 10);
        if (Number.isNaN(intValue)) {
          result.error = 'Enter a whole number';
          return result;
        }
        result.value = intValue;
        return result;
      }
      case 'boolean': {
        result.value = Boolean(rawValue);
        return result;
      }
      case 'date': {
        if (!rawValue) {
          result.value = null;
        } else {
          result.value = rawValue;
        }
        return result;
      }
      case 'json': {
        if (typeof rawValue === 'string') {
          const trimmed = rawValue.trim();
          if (trimmed === '') {
            result.value = null;
            return result;
          }
          try {
            result.value = JSON.parse(trimmed);
          } catch (err) {
            result.error = 'Enter valid JSON';
          }
          return result;
        }
        result.value = rawValue;
        return result;
      }
      case 'curve': {
        if (typeof rawValue !== 'string') {
          result.value = rawValue;
          return result;
        }
        const trimmed = rawValue.trim();
        if (trimmed === '') {
          result.value = [];
          return result;
        }
        if (trimmed.toLowerCase() === 'uniform') {
          result.value = 'uniform';
          return result;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (!Array.isArray(parsed)) {
            result.error = 'Enter "uniform" or a JSON array of numbers';
            return result;
          }
          result.value = parsed;
        } catch (err) {
          result.error = 'Enter "uniform" or a JSON array of numbers';
        }
        return result;
      }
      case 'string':
      default: {
        if (typeof rawValue === 'string') {
          result.value = rawValue;
        } else if (rawValue === null || rawValue === undefined) {
          result.value = '';
        } else {
          result.value = String(rawValue);
        }
        return result;
      }
    }
  }

  function updateConfigValueFromTarget(target) {
    if (!target || !target.dataset) {
      return;
    }
    if (!configData) {
      return;
    }
    const pathValue = target.dataset.configPath
      || (target.dataset.field ? encodeConfigPath([target.dataset.field]) : null)
      || (target.dataset.parent && target.dataset.key
        ? encodeConfigPath([target.dataset.parent, decodeURIComponent(target.dataset.key)])
        : null);
    if (!pathValue) {
      return;
    }
    const pathParts = decodeConfigPath(pathValue);
    if (!pathParts || pathParts.length === 0) {
      return;
    }
    const type = target.dataset.type || 'string';
    const required = target.dataset.required === 'true';
    const rawValue = target.type === 'checkbox' ? target.checked : target.value;
    const { value, error } = parseConfigValue(rawValue, type);
    if (error) {
      setConfigError(pathValue, error, target);
      updateConfigUnsavedIndicator();
      return;
    }
    if (required && (value === null || value === '')) {
      setConfigError(pathValue, 'This field is required', target);
      updateConfigUnsavedIndicator();
      return;
    }
    clearConfigError(pathValue, target);
    setNestedValue(configData, pathParts, value);
    updateConfigUnsavedIndicator();
  }

  function onConfigInput(event) {
    const target = event.target;
    if (!target || !target.dataset) {
      return;
    }
    if (target.dataset.update === 'change') {
      return;
    }
    updateConfigValueFromTarget(target);
  }

  function togglePlanningEndNull(isChecked) {
    const dateInput = document.getElementById('planning-end-input');
    if (!configData) {
      return;
    }
    if (isChecked) {
      previousPlanningEndValue = typeof configData.planning_end === 'string' ? configData.planning_end : '';
      configData.planning_end = null;
      if (dateInput) {
        dateInput.value = '';
        dateInput.disabled = true;
      }
    } else {
      const restored = previousPlanningEndValue || '';
      configData.planning_end = restored || null;
      if (dateInput) {
        dateInput.disabled = false;
        dateInput.value = restored || '';
        dateInput.focus();
      }
    }
    updateConfigUnsavedIndicator();
  }

  function onConfigChange(event) {
    const target = event.target;
    if (!target || !target.dataset) {
      return;
    }
    const action = target.dataset.action;
    if (action === 'toggle-planning-end-null') {
      togglePlanningEndNull(target.checked);
      return;
    }
    if (!target.dataset.update || target.dataset.update === 'change') {
      updateConfigValueFromTarget(target);
    }
  }

  function addRoleToMap(map, promptText) {
    if (!map || typeof map !== 'object') {
      return;
    }
    const roleName = window.prompt(promptText);
    if (!roleName) {
      return;
    }
    const trimmed = roleName.trim();
    if (!trimmed) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(map, trimmed)) {
      window.alert(`Role "${trimmed}" already exists.`);
      return;
    }
    map[trimmed] = 0;
  }

  function onConfigClick(event) {
    const target = event.target;
    if (!target || !target.dataset) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }
    if (!configData) {
      return;
    }
    if (action === 'add-ktlo-role') {
      if (!configData.ktlo_pct_by_role || typeof configData.ktlo_pct_by_role !== 'object') {
        configData.ktlo_pct_by_role = {};
      }
      addRoleToMap(configData.ktlo_pct_by_role, 'Enter the role name to add for KTLO capacity:');
      renderConfigForm();
      updateConfigUnsavedIndicator();
    } else if (action === 'remove-ktlo-role') {
      const role = decodeURIComponent(target.dataset.role || '');
      if (role && configData.ktlo_pct_by_role && Object.prototype.hasOwnProperty.call(configData.ktlo_pct_by_role, role)) {
        const pathValue = encodeConfigPath(['ktlo_pct_by_role', role]);
        delete configErrors[pathValue];
        delete configData.ktlo_pct_by_role[role];
        renderConfigForm();
        updateConfigUnsavedIndicator();
      }
    } else if (action === 'add-concurrency-role') {
      if (!configData.max_concurrent_per_role || typeof configData.max_concurrent_per_role !== 'object') {
        configData.max_concurrent_per_role = {};
      }
      addRoleToMap(configData.max_concurrent_per_role, 'Enter the role name to add for concurrency limits:');
      renderConfigForm();
      updateConfigUnsavedIndicator();
    } else if (action === 'remove-concurrency-role') {
      const role = decodeURIComponent(target.dataset.role || '');
      if (role && configData.max_concurrent_per_role && Object.prototype.hasOwnProperty.call(configData.max_concurrent_per_role, role)) {
        const pathValue = encodeConfigPath(['max_concurrent_per_role', role]);
        delete configErrors[pathValue];
        delete configData.max_concurrent_per_role[role];
        renderConfigForm();
        updateConfigUnsavedIndicator();
      }
    } else if (action === 'add-people-role') {
      // Initialize all three maps if they don't exist
      if (!configData.ktlo_pct_by_role || typeof configData.ktlo_pct_by_role !== 'object') {
        configData.ktlo_pct_by_role = {};
      }
      if (!configData.max_concurrent_per_role || typeof configData.max_concurrent_per_role !== 'object') {
        configData.max_concurrent_per_role = {};
      }
      if (!configData.max_projects_per_person || typeof configData.max_projects_per_person !== 'object') {
        configData.max_projects_per_person = {};
      }
      const roleName = window.prompt('Enter the role name (e.g., Dev, BA, Planner):');
      if (!roleName) return;
      const trimmed = roleName.trim();
      if (!trimmed) return;
      // Check if role already exists in any of the maps
      if (Object.prototype.hasOwnProperty.call(configData.ktlo_pct_by_role, trimmed) ||
          Object.prototype.hasOwnProperty.call(configData.max_concurrent_per_role, trimmed) ||
          Object.prototype.hasOwnProperty.call(configData.max_projects_per_person, trimmed)) {
        window.alert(`Role "${trimmed}" already exists.`);
        return;
      }
      // Add to all three maps with sensible defaults
      configData.ktlo_pct_by_role[trimmed] = 0.15;  // 15% KTLO
      configData.max_concurrent_per_role[trimmed] = 2;  // Max 2 people per project
      configData.max_projects_per_person[trimmed] = 2;  // Max 2 projects per person
      renderConfigForm();
      updateConfigUnsavedIndicator();
    } else if (action === 'remove-people-role') {
      const role = decodeURIComponent(target.dataset.role || '');
      if (role) {
        // Remove from all three maps and clear errors
        if (configData.ktlo_pct_by_role && Object.prototype.hasOwnProperty.call(configData.ktlo_pct_by_role, role)) {
          delete configErrors[encodeConfigPath(['ktlo_pct_by_role', role])];
          delete configData.ktlo_pct_by_role[role];
        }
        if (configData.max_concurrent_per_role && Object.prototype.hasOwnProperty.call(configData.max_concurrent_per_role, role)) {
          delete configErrors[encodeConfigPath(['max_concurrent_per_role', role])];
          delete configData.max_concurrent_per_role[role];
        }
        if (configData.max_projects_per_person && Object.prototype.hasOwnProperty.call(configData.max_projects_per_person, role)) {
          delete configErrors[encodeConfigPath(['max_projects_per_person', role])];
          delete configData.max_projects_per_person[role];
        }
        renderConfigForm();
        updateConfigUnsavedIndicator();
      }
    } else if (action === 'add-curve') {
      if (!configData.curves || typeof configData.curves !== 'object') {
        configData.curves = {};
      }
      const curveName = window.prompt('Enter the curve key (e.g., dev_curve):');
      if (!curveName) {
        return;
      }
      const trimmed = curveName.trim();
      if (!trimmed) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(configData.curves, trimmed)) {
        window.alert(`Curve "${trimmed}" already exists.`);
        return;
      }
      configData.curves[trimmed] = [];
      renderConfigForm();
      updateConfigUnsavedIndicator();
    } else if (action === 'remove-curve') {
      const curve = decodeURIComponent(target.dataset.curve || '');
      if (curve && configData.curves && Object.prototype.hasOwnProperty.call(configData.curves, curve)) {
        const pathValue = encodeConfigPath(['curves', curve]);
        delete configErrors[pathValue];
        delete configData.curves[curve];
        renderConfigForm();
        updateConfigUnsavedIndicator();
      }
    }
  }

  function formatCurveValue(value) {
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    return JSON.stringify(value);
  }

  function renderConfigForm() {
    const container = document.getElementById('config-container');
    const saveBtn = document.getElementById('save-config-btn');
    const discardBtn = document.getElementById('discard-config-btn');
    if (!container) {
      return;
    }

    ensureConfigEventBindings();

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio to edit settings</div>';
      if (saveBtn) saveBtn.style.display = 'none';
      if (discardBtn) discardBtn.style.display = 'none';
      updateConfigUnsavedIndicator();
      return;
    }

    if (!configData) {
      container.innerHTML = '<div class="empty-state">Loading settings...</div>';
      if (saveBtn) saveBtn.style.display = 'none';
      if (discardBtn) discardBtn.style.display = 'none';
      return;
    }

    if (saveBtn) {
      saveBtn.style.display = 'inline-block';
      saveBtn.disabled = false;
    }

    const planningStart = configData.planning_start || '';
    const planningEnd = configData.planning_end;
    const isPlanningEndNull = planningEnd === null || planningEnd === undefined;
    const planningEndValue = isPlanningEndNull ? '' : planningEnd || '';
    if (!isPlanningEndNull) {
      previousPlanningEndValue = planningEndValue;
    }

    const ktloMap = (configData.ktlo_pct_by_role && typeof configData.ktlo_pct_by_role === 'object')
      ? configData.ktlo_pct_by_role
      : {};
    const concurrencyMap = (configData.max_concurrent_per_role && typeof configData.max_concurrent_per_role === 'object')
      ? configData.max_concurrent_per_role
      : {};
    const maxProjectsMap = (configData.max_projects_per_person && typeof configData.max_projects_per_person === 'object')
      ? configData.max_projects_per_person
      : {};
    const curvesMap = (configData.curves && typeof configData.curves === 'object')
      ? configData.curves
      : {};

    const ktloEntries = Object.entries(ktloMap).sort((a, b) => a[0].localeCompare(b[0]));
    const concurrencyEntries = Object.entries(concurrencyMap).sort((a, b) => a[0].localeCompare(b[0]));
    const maxProjectsEntries = Object.entries(maxProjectsMap).sort((a, b) => a[0].localeCompare(b[0]));
    const curveEntries = Object.entries(curvesMap).sort((a, b) => a[0].localeCompare(b[0]));

    // Get all unique roles across all maps
    const allRoles = new Set([...Object.keys(ktloMap), ...Object.keys(concurrencyMap), ...Object.keys(maxProjectsMap)]);
    const peopleSettingsEntries = Array.from(allRoles).sort((a, b) => a.localeCompare(b)).map(role => ({
      role,
      ktlo: ktloMap[role],
      concurrency: concurrencyMap[role],
      maxProjects: maxProjectsMap[role]
    }));

    const friendlyName = configData.friendly_name || '';

    let html = '';

    html += '<div class="config-section">';
    html += '<h3>Portfolio Information</h3>';
    html += '<div class="config-form-grid">';
    html += '<div class="form-group" style="grid-column: span 2;">';
    const friendlyNamePath = encodeConfigPath(['friendly_name']);
    html += '<label for="friendly-name-input">Portfolio Display Name</label>';
    html += `<input id="friendly-name-input" type="text" data-field="friendly_name" data-config-path="${friendlyNamePath}" data-type="string" value="${escapeHtml(friendlyName)}" placeholder="e.g. Enterprise Architecture Roadmap">`;
    html += '<small style="color: var(--gray-600); font-size: 0.75rem; margin-top: 0.25rem; display: block;">This name will appear in reports and exports</small>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="config-section">';
    html += '<h3>Planning Window</h3>';
    html += '<div class="config-form-grid">';
    html += '<div class="form-group">';
    const planningStartPath = encodeConfigPath(['planning_start']);
    html += '<label for="planning-start-input">Planning Start</label>';
    html += `<input id="planning-start-input" type="date" data-field="planning_start" data-config-path="${planningStartPath}" data-type="date" data-required="true" value="${planningStart || ''}">`;
    html += '</div>';
    html += '<div class="form-group">';
    const planningEndPath = encodeConfigPath(['planning_end']);
    html += '<label for="planning-end-input">Planning End</label>';
    html += `<input id="planning-end-input" type="date" data-field="planning_end" data-config-path="${planningEndPath}" data-type="date" value="${planningEndValue}" ${isPlanningEndNull ? 'disabled' : ''}>`;
    html += '<div class="config-checkbox">';
    html += `<input type="checkbox" id="planning-end-null" data-action="toggle-planning-end-null" ${isPlanningEndNull ? 'checked' : ''}>`;
    html += '<label for="planning-end-null">No end date (open ended)</label>';
    html += '</div>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="max-months-open-ended">Max Months (Open Ended)</label>';
    const maxMonthsPath = encodeConfigPath(['max_months_if_open_ended']);
    html += `<input id="max-months-open-ended" type="number" min="1" data-field="max_months_if_open_ended" data-config-path="${maxMonthsPath}" data-type="int" value="${configData.max_months_if_open_ended ?? ''}">`;
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="config-section">';
    html += '<h3>Planner & Runtime</h3>';
    html += '<div class="config-form-grid">';
    html += '<div class="form-group">';
    html += '<label for="planner-project-month-cap">Planner Per-Project Monthly Cap (%)</label>';
    const plannerProjectCapPath = encodeConfigPath(['planner_project_month_cap_pct']);
    html += `<input id="planner-project-month-cap" type="number" step="0.01" min="0" max="1" data-field="planner_project_month_cap_pct" data-config-path="${plannerProjectCapPath}" data-type="number" value="${configData.planner_project_month_cap_pct ?? ''}">`;
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="random-seed-input">Random Seed</label>';
    const seedPath = encodeConfigPath(['random_seed']);
    html += `<input id="random-seed-input" type="number" data-field="random_seed" data-config-path="${seedPath}" data-type="int" value="${configData.random_seed ?? ''}">`;
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="logging-level-input">Logging Level</label>';
    const loggingPath = encodeConfigPath(['logging_level']);
    html += `<input id="logging-level-input" type="text" data-field="logging_level" data-config-path="${loggingPath}" data-type="string" value="${configData.logging_level ?? ''}">`;
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="allocation-mode-select">Allocation Mode</label>';
    const allocationModePath = encodeConfigPath(['allocation_mode']);
    const allocationMode = configData.allocation_mode || 'strict';
    html += `<select id="allocation-mode-select" data-field="allocation_mode" data-config-path="${allocationModePath}" data-type="string">`;
    html += `<option value="strict" ${allocationMode === 'strict' ? 'selected' : ''}>Strict (capacity limits enforced)</option>`;
    html += `<option value="aggressive" ${allocationMode === 'aggressive' ? 'selected' : ''}>Aggressive (schedule all, show hiring needs)</option>`;
    html += '</select>';
    html += '<small style="color: var(--gray-500); margin-top: 0.25rem; display: block;">Aggressive mode over-allocates resources and generates hiring recommendations</small>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="config-section">';
    html += '<div style="display:flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">';
    html += '<h3 style="margin:0;">People Settings (WIP Limits & KTLO)</h3>';
    html += '<button class="btn-primary" type="button" data-action="add-people-role">+ Add Role</button>';
    html += '</div>';
    html += '<div style="margin: 0.5rem 0; padding: 0.75rem; background: var(--blue-50); border-left: 3px solid var(--blue-500); border-radius: 4px; font-size: 0.875rem;">';
    html += '<strong>WIP Limits:</strong>';
    html += '<ul style="margin: 0.5rem 0 0 0; padding-left: 1.5rem; color: var(--gray-700);">';
    html += '<li><strong>Max on Project:</strong> Max people from this role on any single project (e.g., Dev: 2 = max 2 devs per project)</li>';
    html += '<li><strong>Max per Person:</strong> Max concurrent projects one person can work on (e.g., Dev: 2 = each dev works on max 2 projects)</li>';
    html += '<li><strong>KTLO %:</strong> Fraction of time reserved for operational work (0-1, e.g., 0.2 = 20% KTLO)</li>';
    html += '</ul>';
    html += '</div>';
    html += '<div class="table-container"><table class="config-table">';
    html += '<thead><tr><th>Role</th><th>Max on Project</th><th>Max per Person</th><th>KTLO Fraction</th><th style="width:80px;">Actions</th></tr></thead><tbody>';
    if (peopleSettingsEntries.length === 0) {
      html += '<tr><td colspan="5" style="text-align:center; color: var(--gray-500);">No roles defined</td></tr>';
    } else {
      peopleSettingsEntries.forEach(entry => {
        const escapedRoleText = escapeHtml(entry.role);
        const encodedRole = encodeURIComponent(entry.role);
        const concurrencyPath = encodeConfigPath(['max_concurrent_per_role', entry.role]);
        const maxProjectsPath = encodeConfigPath(['max_projects_per_person', entry.role]);
        const ktloPath = encodeConfigPath(['ktlo_pct_by_role', entry.role]);
        html += '<tr>';
        html += `<td style="font-weight: 500;">${escapedRoleText}</td>`;
        html += `<td><input type="number" min="0" step="1" data-config-path="${concurrencyPath}" data-type="int" value="${entry.concurrency ?? ''}" style="width: 100px;" title="Max people from this role on any single project"></td>`;
        html += `<td><input type="number" min="0" step="1" data-config-path="${maxProjectsPath}" data-type="int" value="${entry.maxProjects ?? ''}" style="width: 100px;" title="Max projects one person can work on"></td>`;
        html += `<td><input type="number" step="0.01" min="0" max="1" data-config-path="${ktloPath}" data-type="number" value="${entry.ktlo ?? ''}" style="width: 100px;" title="Fraction of time reserved for KTLO (0-1)"></td>`;
        html += `<td style="text-align:center;"><button type="button" class="delete-project-btn" data-action="remove-people-role" data-role="${encodedRole}">🗑️</button></td>`;
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    html += '</div>';

    html += '<div class="config-section">';
    html += '<div style="display:flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">';
    html += '<h3 style="margin:0;">Curves</h3>';
    html += '<button class="btn-primary" type="button" data-action="add-curve">+ Add Curve</button>';
    html += '</div>';
    if (curveEntries.length === 0) {
      html += '<div class="empty-state" style="margin-top: 0.5rem;">No curves defined</div>';
    } else {
      html += '<div class="config-form-grid">';
      curveEntries.forEach(([curveName, curveValue]) => {
        const escapedCurve = escapeHtml(curveName);
        const encodedCurve = encodeURIComponent(curveName);
        const curvePath = encodeConfigPath(['curves', curveName]);
        html += '<div class="form-group" style="grid-column: span 2;">';
        html += `<label for="curve-${escapedCurve}">${escapedCurve}</label>`;
        html += `<textarea id="curve-${escapedCurve}" data-config-path="${curvePath}" data-type="curve" data-update="change">${formatCurveValue(curveValue)}</textarea>`;
        html += `<button type="button" class="delete-project-btn" style="margin-top:0.5rem;" data-action="remove-curve" data-curve="${encodedCurve}">Remove</button>`;
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    applyConfigErrors();
    updateConfigUnsavedIndicator();
  }

  async function loadConfig() {
    const container = document.getElementById('config-container');
    if (!container) return;

    ensureConfigEventBindings();

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio to edit settings</div>';
      resetConfigState();
      return;
    }

    if (configLoadedPortfolio === selectedPortfolio && configData) {
      renderConfigForm();
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading settings...</div>';
    const saveBtn = document.getElementById('save-config-btn');
    if (saveBtn) {
      saveBtn.style.display = 'none';
      saveBtn.disabled = true;
    }

    try {
      const response = await fetch(`/api/config/${selectedPortfolio}`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">No config.json found for this portfolio.</div>';
        resetConfigState();
        return;
      }
      const data = await response.json();
      if (data && typeof data === 'object') {
        delete data.planner_monthly_cap_pct;
        delete data.planner_multi_project_capacity_pct;
      }
      configData = cloneConfigData(data) || {};
      originalConfigData = cloneConfigData(data) || {};
      configLoadedPortfolio = selectedPortfolio;
      configErrors = {};
      if (typeof configData.planner_project_month_cap_pct !== 'number') {
        configData.planner_project_month_cap_pct = 0.2;
      }
      if (typeof configData.ktlo_pct_by_role !== 'object' || configData.ktlo_pct_by_role === null) {
        configData.ktlo_pct_by_role = {};
      }
      if (typeof configData.max_concurrent_per_role !== 'object' || configData.max_concurrent_per_role === null) {
        configData.max_concurrent_per_role = {};
      }
      if (typeof configData.curves !== 'object' || configData.curves === null) {
        configData.curves = {};
      }
      previousPlanningEndValue = typeof configData.planning_end === 'string' ? configData.planning_end : '';
      renderConfigForm();
    } catch (err) {
      console.error('Error loading config:', err);
      container.innerHTML = '<div class="empty-state">Error loading config.json</div>';
    }
  }

  async function saveConfigData() {
    if (!selectedPortfolio) {
      window.alert('No portfolio selected');
      return;
    }
    if (Object.keys(configErrors).length > 0) {
      window.alert('Please fix validation errors before saving.');
      return;
    }
    const saveBtn = document.getElementById('save-config-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    try {
      const payload = cloneConfigData(configData) || {};
      if (payload && payload.planning_end === '') {
        payload.planning_end = null;
      }
      const response = await fetch(`/api/config/${selectedPortfolio}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let message = 'Failed to save config';
        try {
          const body = await response.json();
          if (body && body.error) {
            message = body.error;
          }
        } catch (err) {
          message = `Failed to save config (status ${response.status})`;
        }
        throw new Error(message);
      }
      originalConfigData = cloneConfigData(configData);
      configErrors = {};
      updateConfigUnsavedIndicator();
      if (saveBtn) {
        saveBtn.textContent = '✓ Saved!';
        window.setTimeout(() => {
          saveBtn.textContent = 'Save Changes';
          saveBtn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      console.error('Error saving config:', err);
      window.alert(err.message || 'Error saving config.json');
      if (saveBtn) {
        saveBtn.textContent = 'Save Changes';
        saveBtn.disabled = false;
      }
    }
  }

  function discardConfigChanges() {
    if (configDirty && !window.confirm('Discard all unsaved config changes?')) {
      return;
    }
    if (!originalConfigData) {
      return;
    }
    configData = cloneConfigData(originalConfigData);
    configErrors = {};
    previousPlanningEndValue = typeof configData.planning_end === 'string' ? configData.planning_end : '';
    renderConfigForm();
    updateConfigUnsavedIndicator();
  }

  // Modeller Settings Display
  async function loadModellerSettings() {
    const container = document.getElementById('modeller-settings-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="info-text">Please select a portfolio to configure the model.</div>';
      return;
    }

    // Try to use cached config if available, otherwise fetch
    let config = modellerConfigCache;
    if (!config || modellerConfigCache?.portfolio !== selectedPortfolio) {
      try {
        const response = await fetch(`/api/config/${selectedPortfolio}`);
        if (!response.ok) {
          container.innerHTML = '<div class="info-text" style="color: var(--danger-color);">Error loading settings. Please check Portfolio Settings.</div>';
          return;
        }
        config = await response.json();
        modellerConfigCache = { portfolio: selectedPortfolio, data: config };
      } catch (err) {
        console.error('Error loading config for modeller:', err);
        container.innerHTML = '<div class="info-text" style="color: var(--danger-color);">Error loading settings.</div>';
        return;
      }
    } else {
      config = modellerConfigCache.data;
    }

    const allocationMode = config.allocation_mode || 'strict';
    const solver = config.solver || 'greedy';
    const planningStart = config.planning_start || 'Not set';
    const planningEnd = config.planning_end === null || config.planning_end === undefined ? 'Open-ended' : (config.planning_end || 'Not set');
    const ktloMap = config.ktlo_pct_by_role || {};
    const curves = config.curves || {};

    let html = '<div class="config-section" style="margin-bottom: 1.5rem;">';
    html += '<h3 style="margin-top: 0;">Model Configuration</h3>';

    // Solver Selector
    html += '<div class="form-group" style="margin-bottom: 1.5rem;">';
    html += '<label for="modeller-solver-select" style="font-size: 1rem; margin-bottom: 0.75rem;">Solver Algorithm</label>';
    html += `<select id="modeller-solver-select" style="font-size: 1rem; padding: 0.75rem;">`;
    html += `<option value="roadmap" ${solver === 'roadmap' ? 'selected' : ''}>Roadmap (simple, one person per role)</option>`;
    html += `<option value="greedy" ${solver === 'greedy' ? 'selected' : ''}>Greedy (fast, heuristic-based)</option>`;
    html += `<option value="ortools" ${solver === 'ortools' ? 'selected' : ''}>OR-Tools (optimization-based, with violations)</option>`;
    html += '</select>';
    html += '<div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--gray-600);">';
    html += '<strong>Roadmap:</strong> Simple high-level planner, assigns one person per role per project. Best for roadmap planning.<br>';
    html += '<strong>Greedy:</strong> Fast heuristic algorithm that schedules projects sequentially.<br>';
    html += '<strong>OR-Tools:</strong> Constraint programming solver that finds optimal schedules and tracks violations (over-allocation, skill mismatches). Generates hiring and training recommendations.';
    html += '</div>';
    html += '</div>';

    // Allocation Mode Selector
    html += '<div class="form-group" style="margin-bottom: 1.5rem;">';
    html += '<label for="modeller-allocation-mode-select" style="font-size: 1rem; margin-bottom: 0.75rem;">Allocation Mode</label>';
    html += `<select id="modeller-allocation-mode-select" style="font-size: 1rem; padding: 0.75rem;">`;
    html += `<option value="strict" ${allocationMode === 'strict' ? 'selected' : ''}>Strict (capacity limits enforced)</option>`;
    html += `<option value="aggressive" ${allocationMode === 'aggressive' ? 'selected' : ''}>Aggressive (schedule all, show hiring needs)</option>`;
    html += '</select>';
    html += '<div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--gray-600);">';
    html += '<strong>Strict mode:</strong> Only schedules projects that fit within current team capacity.<br>';
    html += '<strong>Aggressive mode:</strong> Schedules all projects and generates hiring recommendations for over-allocated resources.';
    html += '</div>';
    html += '</div>';

    // Settings Summary
    html += '<div style="background: var(--gray-50); padding: 1rem; border-radius: var(--border-radius); border: 1px solid var(--gray-200);">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">';
    html += '<h4 style="margin: 0; font-size: 0.95rem; color: var(--gray-800);">Current Constraints</h4>';
    html += '<button class="btn-secondary" style="padding: 0.375rem 0.75rem; font-size: 0.8rem;" onclick="switchToSettingsTab()">Edit Settings →</button>';
    html += '</div>';

    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">';

    // Planning Period
    html += '<div>';
    html += '<div style="color: var(--gray-600); font-weight: 600;">Planning Period</div>';
    html += `<div style="color: var(--gray-900);">${planningStart} → ${planningEnd}</div>`;
    html += '</div>';

    // KTLO Summary
    html += '<div>';
    html += '<div style="color: var(--gray-600); font-weight: 600;">KTLO Percentages</div>';
    const ktloEntries = Object.entries(ktloMap);
    if (ktloEntries.length > 0) {
      html += '<div style="color: var(--gray-900);">';
      ktloEntries.slice(0, 3).forEach(([role, pct]) => {
        html += `${role}: ${(pct * 100).toFixed(0)}%<br>`;
      });
      if (ktloEntries.length > 3) {
        html += `<span style="color: var(--gray-500);">+${ktloEntries.length - 3} more...</span>`;
      }
      html += '</div>';
    } else {
      html += '<div style="color: var(--gray-500);">None configured</div>';
    }
    html += '</div>';

    // Curves Summary
    html += '<div>';
    html += '<div style="color: var(--gray-600); font-weight: 600;">Effort Curves</div>';
    const curveEntries = Object.entries(curves);
    if (curveEntries.length > 0) {
      html += `<div style="color: var(--gray-900);">${curveEntries.length} curve(s) defined</div>`;
    } else {
      html += '<div style="color: var(--gray-500);">None configured</div>';
    }
    html += '</div>';

    // Planner Cap
    const plannerCap = config.planner_project_month_cap_pct;
    if (plannerCap !== undefined && plannerCap !== null) {
      html += '<div>';
      html += '<div style="color: var(--gray-600); font-weight: 600;">Planner Cap</div>';
      html += `<div style="color: var(--gray-900);">${(plannerCap * 100).toFixed(0)}% per project/month</div>`;
      html += '</div>';
    }

    html += '</div>'; // end grid
    html += '</div>'; // end summary box
    html += '</div>'; // end config-section

    container.innerHTML = html;

    // Add event listener for solver changes
    const solverSelect = document.getElementById('modeller-solver-select');
    if (solverSelect) {
      solverSelect.addEventListener('change', async (e) => {
        const newSolver = e.target.value;
        try {
          // Update the config
          const updateResponse = await fetch(`/api/config/${selectedPortfolio}`);
          if (!updateResponse.ok) {
            alert('Failed to load current config');
            return;
          }
          const currentConfig = await updateResponse.json();
          currentConfig.solver = newSolver;

          const saveResponse = await fetch(`/api/config/${selectedPortfolio}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentConfig)
          });

          if (!saveResponse.ok) {
            alert('Failed to save solver choice');
            return;
          }

          // Update cache
          modellerConfigCache = { portfolio: selectedPortfolio, data: currentConfig };

          // Update configData if it's loaded
          if (configData && configLoadedPortfolio === selectedPortfolio) {
            configData.solver = newSolver;
            originalConfigData.solver = newSolver;
          }

          console.log(`Solver changed to: ${newSolver}`);
        } catch (err) {
          console.error('Error saving solver choice:', err);
          alert('Failed to save solver choice. Please try again.');
        }
      });
    }

    // Add event listener for allocation mode changes
    const modeSelect = document.getElementById('modeller-allocation-mode-select');
    if (modeSelect) {
      modeSelect.addEventListener('change', async (e) => {
        const newMode = e.target.value;
        try {
          // Update the config
          const updateResponse = await fetch(`/api/config/${selectedPortfolio}`);
          if (!updateResponse.ok) {
            alert('Failed to load current config');
            return;
          }
          const currentConfig = await updateResponse.json();
          currentConfig.allocation_mode = newMode;

          const saveResponse = await fetch(`/api/config/${selectedPortfolio}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentConfig)
          });

          if (!saveResponse.ok) {
            alert('Failed to save allocation mode');
            return;
          }

          // Update cache
          modellerConfigCache = { portfolio: selectedPortfolio, data: currentConfig };

          // Update configData if it's loaded
          if (configData && configLoadedPortfolio === selectedPortfolio) {
            configData.allocation_mode = newMode;
            originalConfigData.allocation_mode = newMode;
          }

          setStatus(`Allocation mode updated to ${newMode}`);
        } catch (err) {
          console.error('Error updating allocation mode:', err);
          alert('Failed to update allocation mode');
        }
      });
    }
  }

  window.switchToSettingsTab = function() {
    const settingsTab = document.querySelector('.tab[data-tab="settings"]');
    if (settingsTab) {
      settingsTab.click();
    }
  };

  const saveConfigBtn = document.getElementById('save-config-btn');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', () => {
      saveConfigData();
    });
  }

  const discardConfigBtn = document.getElementById('discard-config-btn');
  if (discardConfigBtn) {
    discardConfigBtn.addEventListener('click', () => {
      discardConfigChanges();
    });
  }

  // Projects Management
  let projectsData = [];
  let originalProjectsData = [];
  const PROJECTS_COLUMNS = [
    { key: 'id', label: 'ID', width: '80px' },
    { key: 'name', label: 'Name', width: '150px' },
    { key: 'priority', label: 'Priority', width: '80px' },
    { key: 'effort_ba_pm', label: 'BA (PM)', width: '80px' },
    { key: 'effort_planner_pm', label: 'Planner (PM)', width: '100px' },
    { key: 'effort_dev_pm', label: 'Dev (PM)', width: '80px' },
    { key: 'parent_summary', label: 'Program', width: '120px' },
    { key: 'required_skillsets_ba', label: 'BA Skills', width: '120px' },
    { key: 'required_skillsets_planner', label: 'Planner Skills', width: '120px' },
    { key: 'required_skillsets_dev', label: 'Dev Skills', width: '120px' }
  ];

  // Renumber priorities based on current order
  function renumberPriorities() {
    projectsData.forEach((project, index) => {
      project.priority = String(index + 1);
    });
  }

  // Deep clone function for projects
  function cloneProjectsData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  // Check if there are unsaved changes
  function hasUnsavedProjectChanges() {
    if (projectsData.length !== originalProjectsData.length) {
      return true;
    }

    for (let i = 0; i < projectsData.length; i++) {
      const current = projectsData[i];
      const original = originalProjectsData[i];

      for (let col of PROJECTS_COLUMNS) {
        const currentVal = (current[col.key] || '').trim();
        const originalVal = (original[col.key] || '').trim();
        if (currentVal !== originalVal) {
          return true;
        }
      }
    }

    return false;
  }

  // Update unsaved changes indicator
  function updateUnsavedIndicator() {
    const indicator = document.getElementById('unsaved-projects-indicator');
    const discardBtn = document.getElementById('discard-projects-btn');
    const hasChanges = hasUnsavedProjectChanges();

    if (indicator) {
      if (hasChanges) {
        indicator.classList.add('visible');
      } else {
        indicator.classList.remove('visible');
      }
    }

    if (discardBtn) {
      discardBtn.style.display = hasChanges ? 'inline-block' : 'none';
    }
  }

  // Get changed fields for a project
  function getChangedFields(index) {
    if (index >= originalProjectsData.length) {
      // New project
      return PROJECTS_COLUMNS.map(col => col.key);
    }

    const changedFields = [];
    const current = projectsData[index];
    const original = originalProjectsData[index];

    for (let col of PROJECTS_COLUMNS) {
      const currentVal = (current[col.key] || '').trim();
      const originalVal = (original[col.key] || '').trim();
      if (currentVal !== originalVal) {
        changedFields.push(col.key);
      }
    }

    return changedFields;
  }

  function loadProjects() {
    const activeSubtab = document.querySelector('#projects .subtab.active');
    const subtabName = activeSubtab ? activeSubtab.dataset.subtab : 'projects-input';
    if (subtabName === 'projects-programs') {
      loadPrograms();
    } else if (subtabName === 'projects-timeline') {
      loadProjectsTimeline();
    } else if (subtabName === 'projects-unallocated') {
      loadUnallocatedProjects();
    } else {
      loadProjectsInput();
    }
  }

  // Load projects input (projects.csv)
  async function loadProjectsInput() {
    const container = document.getElementById('projects-input-container');
    const addBtn = document.getElementById('add-project-btn');
    const saveBtn = document.getElementById('save-projects-btn');

    if (!container) return;

    if (!selectedPortfolio) {
      projectsData = [];
      originalProjectsData = [];
      updateProjectProgramFilterOptions();
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      if (addBtn) addBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading projects...</div>';
    if (addBtn) addBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';

    await ensureProgramsLoaded();

    // Load skills for autocomplete
    if (skillsData.length === 0) {
      try {
        const skillsResponse = await fetch(`/api/skills/${selectedPortfolio}`);
        if (skillsResponse.ok) {
          skillsData = await skillsResponse.json();
        }
      } catch (err) {
        console.error('Error loading skills for projects:', err);
      }
    }

    try {
      const response = await fetch(`/api/projects/${selectedPortfolio}`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">No projects found. Click "Add Project" to create your first project.</div>';
        projectsData = [];
        originalProjectsData = [];
        updateProjectProgramFilterOptions();
        if (addBtn) addBtn.style.display = 'inline-block';
        return;
      }

      projectsData = await response.json();
      // Ensure priorities are set correctly on load
      renumberPriorities();
      // Save original state for change tracking
      originalProjectsData = cloneProjectsData(projectsData);
      renderEditableProjectsTable();
      updateUnsavedIndicator();
      if (addBtn) addBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.style.display = 'inline-block';
    } catch (err) {
      console.error('Error loading projects:', err);
      container.innerHTML = '<div class="empty-state">Error loading projects data</div>';
      projectsData = [];
      originalProjectsData = [];
      updateProjectProgramFilterOptions();
    }
  }

  // Render projects input table with editable cells
  function renderEditableProjectsTable() {
    const container = document.getElementById('projects-input-container');
    if (!container) return;

    const filterChanged = updateProjectProgramFilterOptions();

    if (projectsData.length === 0) {
      container.innerHTML = '<div class="empty-state">No projects found. Click "Add Project" to get started.</div>';
      if (filterChanged) {
        rerenderTimelineFromCache();
      }
      return;
    }

    const visibleIndices = [];
    projectsData.forEach((project, index) => {
      if (matchesProgramFilter(project.parent_summary)) {
        visibleIndices.push(index);
      }
    });

    if (visibleIndices.length === 0) {
      container.innerHTML = '<div class="empty-state">No projects match the selected program.</div>';
      if (filterChanged) {
        rerenderTimelineFromCache();
      }
      return;
    }

    const isFilteredView = projectProgramFilter !== PROGRAM_FILTER_ALL;

    let html = '<div class="table-container"><table class="allocation-table" id="projects-edit-table">';
    html += '<thead><tr>';

    PROJECTS_COLUMNS.forEach(col => {
      html += `<th style="min-width: ${col.width}">${col.label}</th>`;
    });
    html += '<th style="width: 80px">Actions</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    visibleIndices.forEach((dataIndex, visibleIndex) => {
      const project = projectsData[dataIndex];
      const changedFields = getChangedFields(dataIndex);
      const isNewRow = dataIndex >= originalProjectsData.length;
      const rowClass = isNewRow ? 'project-row new-row' : 'project-row';
      const programName = project.parent_summary || '';
      const programColor = programName ? getProgramColor(programName, visibleIndex) : '';
      let rowAttributes = '';
      if (programColor) {
        const bgColor = getProgramBackground(programColor);
        rowAttributes = ` data-program-color="${programColor}" style="--program-color:${programColor}; --program-bg:${bgColor};"`;
      }

      html += `<tr data-index="${dataIndex}" class="${rowClass}"${rowAttributes}>`;

      PROJECTS_COLUMNS.forEach(col => {
        const value = project[col.key] || '';
        const isEditable = col.key !== 'priority'; // Priority is auto-calculated
        const isChanged = changedFields.includes(col.key);
        const cellClass = isChanged ? 'editable-cell changed' : 'editable-cell';

        // Use dropdown for parent_summary (Program)
        if (col.key === 'parent_summary') {
          const bgColor = programColor ? getProgramBackground(programColor) : '';
          const colorStyle = programColor ? `color: ${programColor}; background: ${bgColor}; font-weight: 500;` : '';
          html += `<td class="${cellClass}" data-field="${col.key}" data-index="${dataIndex}">`;
          html += `<select class="program-select" data-index="${dataIndex}" style="width: 100%; padding: 0.5rem; border: 1px solid var(--gray-300); border-radius: 4px; background: white; white-space: normal; height: auto; min-height: 2.5rem; ${colorStyle}">`;
          html += `<option value="">No Program</option>`;
          programsData.forEach(prog => {
            const selected = prog.name === value ? 'selected' : '';
            const optColor = getProgramColor(prog.name, 0);
            const optBgColor = getProgramBackground(optColor);
            const optStyle = `color: ${optColor}; background: ${optBgColor}; font-weight: 500;`;
            html += `<option value="${escapeHtml(prog.name)}" ${selected} style="${optStyle}">${escapeHtml(prog.name)}</option>`;
          });
          html += `</select>`;
          html += `</td>`;
        } else if (col.key === 'id' || col.key === 'name') {
          // Color ID and Name cells according to program color with background
          const bgColor = programColor ? getProgramBackground(programColor) : '';
          const colorStyle = programColor ? `color: ${programColor}; background: ${bgColor};` : '';
          html += `<td class="${cellClass}" contenteditable="${isEditable}" data-field="${col.key}" data-index="${dataIndex}" style="${colorStyle}">${escapeHtml(value)}</td>`;
        } else if (col.key.startsWith('required_skillsets_')) {
          // Display skills with an edit button
          const skillsList = value ? value.split(';').map(s => s.trim()).filter(s => s).join(', ') : '';
          const roleType = col.key.replace('required_skillsets_', '');
          html += `<td class="${cellClass}" data-field="${col.key}" data-index="${dataIndex}" style="position: relative;">`;
          html += `<div style="display: flex; align-items: center; gap: 0.5rem;">`;
          html += `<div style="flex: 1; font-size: 0.875rem; color: var(--gray-700); line-height: 1.4;">${escapeHtml(skillsList) || '<span style="color: var(--gray-400);">No skills</span>'}</div>`;
          html += `<button class="edit-skills-btn" data-index="${dataIndex}" data-role="${roleType}" title="Edit Skills" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--blue-500); color: white; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">Edit</button>`;
          html += `</div>`;
          html += `</td>`;
        } else {
          html += `<td class="${cellClass}" contenteditable="${isEditable}" data-field="${col.key}" data-index="${dataIndex}">${escapeHtml(value)}</td>`;
        }
      });

      const disableMoveUp = isFilteredView || dataIndex === 0;
      const disableMoveDown = isFilteredView || dataIndex === projectsData.length - 1;

      html += `<td class="actions-cell" style="text-align: center;">`;
      html += `<button class="priority-btn" onclick="moveProjectUp(${dataIndex})" title="Move Up" ${disableMoveUp ? 'disabled' : ''}>▲</button>`;
      html += `<button class="priority-btn" onclick="moveProjectDown(${dataIndex})" title="Move Down" ${disableMoveDown ? 'disabled' : ''}>▼</button>`;
      html += `<button class="delete-project-btn" onclick="deleteProject(${dataIndex})" title="Delete">🗑️</button>`;
      html += `</td>`;
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    container.innerHTML = html;

    // Add change event listeners for program dropdowns
    const programSelects = container.querySelectorAll('.program-select');
    programSelects.forEach(select => {
      select.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        const newValue = e.target.value;

        if (projectsData[index]) {
          projectsData[index].parent_summary = newValue;
          // Update change indicators
          updateUnsavedIndicator();
          renderEditableProjectsTable();
        }
      });
    });

    // Add click event listeners for edit skills buttons
    const editSkillsBtns = container.querySelectorAll('.edit-skills-btn');
    editSkillsBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const index = parseInt(e.target.dataset.index);
        const roleType = e.target.dataset.role;
        openSkillsModal(index, roleType);
      });
    });

    // Add blur event listeners to update data
    const editableCells = container.querySelectorAll('.editable-cell');
    editableCells.forEach(cell => {
      cell.addEventListener('blur', (e) => {
        const index = parseInt(e.target.dataset.index);
        const field = e.target.dataset.field;
        const newValue = e.target.textContent.trim();

        if (projectsData[index]) {
          projectsData[index][field] = newValue;
          // Update change indicators
          updateUnsavedIndicator();
          renderEditableProjectsTable();
        }
      });

      // Allow Enter to create new line, but Shift+Enter to go to next cell
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.target.blur();
          // Move to next cell
          const nextCell = e.target.parentElement.nextElementSibling?.querySelector('.editable-cell');
          if (nextCell) {
            nextCell.focus();
          }
        }
      });
    });

    if (filterChanged) {
      rerenderTimelineFromCache();
    }
  }

  // Open skills modal for editing project skills
  function openSkillsModal(projectIndex, roleType) {
    const project = projectsData[projectIndex];
    if (!project) return;

    const fieldKey = `required_skillsets_${roleType}`;
    const currentSkills = project[fieldKey] ? project[fieldKey].split(';').map(s => s.trim()).filter(s => s) : [];

    // Get available skills for this role
    const roleCategory = roleType === 'ba' ? 'BA' : roleType === 'planner' ? 'Planner' : 'Dev';
    const availableSkills = skillsData.filter(s => !s.category || s.category === roleCategory || s.category === 'General');

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'skills-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    `;

    const projectName = project.name || project.id || 'Project';
    const roleName = roleType.charAt(0).toUpperCase() + roleType.slice(1);

    let html = `<h3 style="margin-top: 0; margin-bottom: 1rem; color: #1f2937; font-size: 1.25rem;">Edit ${roleName} Skills for ${projectName}</h3>`;

    // Add new skill section
    html += `<div style="margin-bottom: 1.5rem; padding: 1rem; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px;">`;
    html += `<p style="font-size: 0.875rem; color: #1e40af; margin-bottom: 0.75rem; font-weight: 600;">➕ Add New Skill</p>`;
    html += `<div style="display: flex; gap: 0.5rem; align-items: flex-start;">`;
    html += `<input type="text" id="new-skill-name" placeholder="Skill name (e.g., Python, Agile)" style="flex: 1; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.875rem;">`;
    html += `<button id="add-new-skill-btn" style="padding: 0.5rem 1rem; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; white-space: nowrap; font-size: 0.875rem;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">Add Skill</button>`;
    html += `</div>`;
    html += `<p id="add-skill-message" style="font-size: 0.75rem; margin-top: 0.5rem; min-height: 1rem;"></p>`;
    html += `</div>`;

    html += `<div style="margin-bottom: 1.5rem;">`;
    html += `<p style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem; font-weight: 500;">Check the boxes to add or remove skills:</p>`;
    html += `<p style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 1rem;">✓ Checked = Required for project &nbsp; | &nbsp; ☐ Unchecked = Not required</p>`;

    // Show available skills as checkboxes
    html += `<div id="skills-list-container" style="max-height: 300px; overflow-y: auto; border: 1px solid #d1d5db; border-radius: 4px; padding: 1rem; background: #f9fafb;">`;
    if (availableSkills.length === 0) {
      html += `<p style="color: #9ca3af; font-size: 0.875rem; text-align: center;">No skills available yet. Add your first skill above!</p>`;
    } else {
      availableSkills.forEach(skill => {
        const isChecked = currentSkills.includes(skill.skill_id);
        html += `<div style="margin-bottom: 0.5rem;">`;
        html += `<label style="display: flex; align-items: center; cursor: pointer; padding: 0.5rem; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'">`;
        html += `<input type="checkbox" class="skill-checkbox" value="${escapeHtml(skill.skill_id)}" ${isChecked ? 'checked' : ''} style="margin-right: 0.75rem; width: 16px; height: 16px; cursor: pointer;">`;
        html += `<span style="font-size: 0.875rem; color: #374151;">${escapeHtml(skill.name)}</span>`;
        html += `</label>`;
        html += `</div>`;
      });
    }
    html += `</div>`;
    html += `</div>`;

    // Buttons
    html += `<div style="display: flex; gap: 0.5rem; justify-content: flex-end;">`;
    html += `<button id="cancel-skills-btn" style="padding: 0.5rem 1rem; background: #e5e7eb; color: #374151; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; transition: background 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">Cancel</button>`;
    html += `<button id="save-skills-btn" style="padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; transition: background 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">Save</button>`;
    html += `</div>`;

    modalContent.innerHTML = html;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Event listeners
    const cancelBtn = modalContent.querySelector('#cancel-skills-btn');
    const saveBtn = modalContent.querySelector('#save-skills-btn');
    const addNewSkillBtn = modalContent.querySelector('#add-new-skill-btn');
    const newSkillInput = modalContent.querySelector('#new-skill-name');
    const messageEl = modalContent.querySelector('#add-skill-message');

    cancelBtn.addEventListener('click', () => {
      modal.remove();
    });

    saveBtn.addEventListener('click', () => {
      const checkboxes = modalContent.querySelectorAll('.skill-checkbox:checked');
      const selectedSkills = Array.from(checkboxes).map(cb => cb.value);
      projectsData[projectIndex][fieldKey] = selectedSkills.join(';');
      updateUnsavedIndicator();
      renderEditableProjectsTable();
      modal.remove();
    });

    // Add new skill functionality
    addNewSkillBtn.addEventListener('click', async () => {
      const skillName = newSkillInput.value.trim();

      if (!skillName) {
        messageEl.style.color = '#dc2626';
        messageEl.textContent = '⚠️ Please enter a skill name';
        return;
      }

      // Generate skill_id from name
      const skillId = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

      // Check if skill already exists
      if (skillsData.some(s => s.skill_id === skillId || s.name.toLowerCase() === skillName.toLowerCase())) {
        messageEl.style.color = '#dc2626';
        messageEl.textContent = '⚠️ This skill already exists';
        return;
      }

      // Add to skillsData array
      const newSkill = {
        skill_id: skillId,
        name: skillName,
        category: roleCategory,
        description: ''
      };

      skillsData.push(newSkill);

      // Save to backend
      try {
        messageEl.style.color = '#6b7280';
        messageEl.textContent = '💾 Saving...';
        addNewSkillBtn.disabled = true;

        const response = await fetch(`/api/skills/${selectedPortfolio}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(skillsData)
        });

        if (!response.ok) {
          throw new Error('Failed to save skill');
        }

        messageEl.style.color = '#10b981';
        messageEl.textContent = '✓ Skill added successfully!';
        newSkillInput.value = '';
        addNewSkillBtn.disabled = false;

        // Re-render the skills list with the new skill checked
        const skillsListContainer = modalContent.querySelector('#skills-list-container');
        let updatedHtml = '';

        const allSkills = skillsData.filter(s => !s.category || s.category === roleCategory || s.category === 'General');
        allSkills.forEach(skill => {
          const isChecked = currentSkills.includes(skill.skill_id) || skill.skill_id === skillId;
          updatedHtml += `<div style="margin-bottom: 0.5rem;">`;
          updatedHtml += `<label style="display: flex; align-items: center; cursor: pointer; padding: 0.5rem; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'">`;
          updatedHtml += `<input type="checkbox" class="skill-checkbox" value="${escapeHtml(skill.skill_id)}" ${isChecked ? 'checked' : ''} style="margin-right: 0.75rem; width: 16px; height: 16px; cursor: pointer;">`;
          updatedHtml += `<span style="font-size: 0.875rem; color: #374151;">${escapeHtml(skill.name)}</span>`;
          if (skill.skill_id === skillId) {
            updatedHtml += `<span style="margin-left: 0.5rem; font-size: 0.75rem; color: #10b981; font-weight: 500;">NEW</span>`;
          }
          updatedHtml += `</label>`;
          updatedHtml += `</div>`;
        });

        skillsListContainer.innerHTML = updatedHtml;

        // Auto-check the new skill
        if (!currentSkills.includes(skillId)) {
          currentSkills.push(skillId);
        }

        // Clear message after 3 seconds
        setTimeout(() => {
          messageEl.textContent = '';
        }, 3000);

      } catch (err) {
        console.error('Error adding skill:', err);
        messageEl.style.color = '#dc2626';
        messageEl.textContent = '❌ Failed to save skill';
        addNewSkillBtn.disabled = false;

        // Remove from local array if save failed
        const index = skillsData.findIndex(s => s.skill_id === skillId);
        if (index !== -1) {
          skillsData.splice(index, 1);
        }
      }
    });

    // Allow Enter key to add skill
    newSkillInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addNewSkillBtn.click();
      }
    });

    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  // Helper to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Add new project
  window.addProject = function() {
    const newProject = {};
    PROJECTS_COLUMNS.forEach(col => {
      newProject[col.key] = '';
    });

    projectsData.push(newProject);
    renumberPriorities(); // Set priority for new project
    updateUnsavedIndicator();
    renderEditableProjectsTable();

    // Focus on the first cell of the new row
    const container = document.getElementById('projects-input-container');
    const lastRow = container.querySelector('tbody tr:last-child');
    if (lastRow) {
      const firstCell = lastRow.querySelector('.editable-cell');
      if (firstCell) {
        firstCell.focus();
      }
    }
  };

  // Move project up in priority
  window.moveProjectUp = function(index) {
    if (index === 0) return; // Already at top

    // Swap with previous project
    const temp = projectsData[index];
    projectsData[index] = projectsData[index - 1];
    projectsData[index - 1] = temp;

    // Renumber priorities
    renumberPriorities();
    updateUnsavedIndicator();
    renderEditableProjectsTable();
  };

  // Move project down in priority
  window.moveProjectDown = function(index) {
    if (index === projectsData.length - 1) return; // Already at bottom

    // Swap with next project
    const temp = projectsData[index];
    projectsData[index] = projectsData[index + 1];
    projectsData[index + 1] = temp;

    // Renumber priorities
    renumberPriorities();
    updateUnsavedIndicator();
    renderEditableProjectsTable();
  };

  // Delete project
  window.deleteProject = function(index) {
    const project = projectsData[index];
    const projectName = project.name || project.id || 'this project';

    if (!confirm(`Are you sure you want to delete ${projectName}?`)) {
      return;
    }

    projectsData.splice(index, 1);
    renumberPriorities(); // Renumber after deletion
    updateUnsavedIndicator();
    renderEditableProjectsTable();
  };

  // Discard changes and reload original data
  window.discardProjectChanges = function() {
    if (!confirm('Are you sure you want to discard all unsaved changes?')) {
      return;
    }

    // Restore original data
    projectsData = cloneProjectsData(originalProjectsData);
    updateUnsavedIndicator();
    renderEditableProjectsTable();
  };

  // Save projects data
  async function saveProjectsData() {
    if (!selectedPortfolio) {
      alert('No portfolio selected');
      return;
    }

    const saveBtn = document.getElementById('save-projects-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';

    if (saveBtn) {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;
    }

    try {
      const response = await fetch(`/api/projects/${selectedPortfolio}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(projectsData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save');
      }

      // Update original data after successful save
      originalProjectsData = cloneProjectsData(projectsData);
      updateUnsavedIndicator();
      renderEditableProjectsTable(); // Re-render to clear highlights

      if (saveBtn) {
        saveBtn.textContent = '✓ Saved!';
        setTimeout(() => {
          saveBtn.textContent = originalText;
        }, 2000);
      }

      console.log('Projects data saved successfully');
    } catch (err) {
      console.error('Error saving projects:', err);
      alert('Error saving projects data: ' + err.message);

      if (saveBtn) {
        saveBtn.textContent = originalText;
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
      }
    }
  }

  // Wire up button event listeners
  const addProjectBtn = document.getElementById('add-project-btn');
  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', addProject);
  }

  const saveProjectsBtn = document.getElementById('save-projects-btn');
  if (saveProjectsBtn) {
    saveProjectsBtn.addEventListener('click', saveProjectsData);
  }

  const discardProjectsBtn = document.getElementById('discard-projects-btn');
  if (discardProjectsBtn) {
    discardProjectsBtn.addEventListener('click', discardProjectChanges);
  }

  // Helper function to create results metadata banner
  async function createResultsMetadata(options = {}) {
    const { includeModelSettings = true } = options;

    try {
      // Fetch file info and config in parallel
      const [fileResponse, configResponse] = await Promise.all([
        fetch(`/api/files/${selectedPortfolio}`),
        fetch(`/api/config/${selectedPortfolio}`)
      ]);

      if (!fileResponse.ok || !configResponse.ok) return null;

      const fileData = await fileResponse.json();
      const config = await configResponse.json();

      // Find the most recent output file timestamp
      const outputFiles = fileData.output || [];
      if (outputFiles.length === 0) return null;

      const mostRecentFile = outputFiles.reduce((latest, file) => {
        const fileDate = new Date(file.modified);
        const latestDate = new Date(latest.modified);
        return fileDate > latestDate ? file : latest;
      });

      const generatedDate = new Date(mostRecentFile.modified);
      const solver = config.solver || 'greedy';
      const allocationMode = config.allocation_mode || 'strict';

      let metadataHtml = `
        <div class="results-metadata">
          <div class="results-metadata-item">
            <span class="results-metadata-label">📅 Generated:</span>
            <span class="results-metadata-value">${generatedDate.toLocaleString()}</span>
          </div>`;

      if (includeModelSettings) {
        let solverLabel = 'Roadmap (simple)';
        if (solver === 'greedy') {
          solverLabel = 'Greedy (heuristic)';
        } else if (solver === 'ortools') {
          solverLabel = 'OR-Tools (optimization)';
        }

        metadataHtml += `
          <div class="results-metadata-item">
            <span class="results-metadata-label">🔧 Solver:</span>
            <span class="results-metadata-value">${solverLabel}</span>
          </div>
          <div class="results-metadata-item">
            <span class="results-metadata-label">⚙️ Mode:</span>
            <span class="results-metadata-value">${allocationMode === 'strict' ? 'Strict (capacity limits)' : 'Aggressive (show hiring needs)'}</span>
          </div>`;
      }

      metadataHtml += `
        </div>
      `;

      return metadataHtml;
    } catch (err) {
      console.error('Error creating results metadata:', err);
      return null;
    }
  }

  // Load projects timeline
  async function loadProjectsTimeline(options = {}) {
    const { forceReload = false } = options || {};
    const container = document.getElementById('projects-timeline-container');
    if (!container) return;

    if (!selectedPortfolio) {
      updateTimelineProgramFilterOptions([]);
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      return;
    }

    await ensureProgramsLoaded();

    if (!forceReload && cachedTimelineData && cachedTimelinePortfolio === selectedPortfolio) {
      renderProjectTimeline(cachedTimelineData, container);
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading timeline...</div>';

    try {
      // Fetch both timeline and resource allocation data in parallel
      const [timelineResponse, resourceResponse] = await Promise.all([
        fetch(`/files/${selectedPortfolio}/output/project_timeline.csv`),
        fetch(`/files/${selectedPortfolio}/output/resource_capacity.csv`)
      ]);

      if (!timelineResponse.ok) {
        cachedTimelineData = null;
        cachedTimelinePortfolio = selectedPortfolio;
        cachedResourceAllocationData = null;
        cachedResourceAllocationPortfolio = null;
        updateTimelineProgramFilterOptions([]);
        container.innerHTML = '<div class="empty-state">No timeline data found. Run the portfolio first to generate results.</div>';
        return;
      }

      const timelineText = await timelineResponse.text();
      const timelineData = parseCSV(timelineText);
      cachedTimelineData = timelineData;
      cachedTimelinePortfolio = selectedPortfolio;

      // Load resource allocation data if available
      if (resourceResponse.ok) {
        const resourceText = await resourceResponse.text();
        const resourceData = parseCSV(resourceText);
        cachedResourceAllocationData = resourceData;
        cachedResourceAllocationPortfolio = selectedPortfolio;
      } else {
        cachedResourceAllocationData = null;
        cachedResourceAllocationPortfolio = null;
      }

      renderProjectTimeline(timelineData, container);
    } catch (err) {
      console.error('Error loading timeline:', err);
      cachedTimelineData = null;
      cachedTimelinePortfolio = null;
      cachedResourceAllocationData = null;
      cachedResourceAllocationPortfolio = null;
      updateTimelineProgramFilterOptions([]);
      container.innerHTML = '<div class="empty-state">Error loading timeline data</div>';
    }
  }

  async function loadUnallocatedProjects(options = {}) {
    const { forceReload = false } = options || {};
    const container = document.getElementById('projects-unallocated-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Please select a portfolio from the dropdown above</div>';
      return;
    }

    if (
      !forceReload
      && cachedUnallocatedPortfolio === selectedPortfolio
      && cachedUnallocatedHtml !== null
    ) {
      container.innerHTML = cachedUnallocatedHtml;
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading unallocated summary...</div>';

    try {
      const response = await fetch(`/files/${selectedPortfolio}/output/unallocated_projects.md`);
      if (!response.ok) {
        if (response.status === 404) {
          const message = '<div class="empty-state">No unallocated items found. Run the portfolio model to generate this report.</div>';
          container.innerHTML = message;
          cachedUnallocatedHtml = message;
          cachedUnallocatedPortfolio = selectedPortfolio;
          return;
        }
        throw new Error(`Request failed with status ${response.status}`);
      }

      const markdownText = await response.text();
      if (!markdownText.trim()) {
        const message = '<div class="empty-state">No unallocated items found.</div>';
        container.innerHTML = message;
        cachedUnallocatedHtml = message;
        cachedUnallocatedPortfolio = selectedPortfolio;
        return;
      }

      const bodyHtml = markdownToHtml(markdownText);
      const wrapped = `<div class="markdown-body">${bodyHtml}</div>`;

      // Add metadata banner
      createResultsMetadata().then(metadataHtml => {
        const fullHtml = metadataHtml ? metadataHtml + wrapped : wrapped;
        container.innerHTML = fullHtml;
        cachedUnallocatedHtml = fullHtml;
        cachedUnallocatedPortfolio = selectedPortfolio;
      }).catch(() => {
        container.innerHTML = wrapped;
        cachedUnallocatedHtml = wrapped;
        cachedUnallocatedPortfolio = selectedPortfolio;
      });
    } catch (err) {
      console.error('Error loading unallocated projects:', err);
      const message = '<div class="empty-state">Error loading unallocated projects summary</div>';
      container.innerHTML = message;
      cachedUnallocatedHtml = message;
      cachedUnallocatedPortfolio = selectedPortfolio;
    }
  }

  // Render project timeline visualization
  function renderProjectTimeline(data, container) {
    const rows = Array.isArray(data) ? data : [];
    const filterAdjusted = updateTimelineProgramFilterOptions(rows);

    if (rows.length === 0) {
      container.innerHTML = '<div class="empty-state">No timeline data found</div>';
      if (filterAdjusted) {
        renderEditableProjectsTable();
      }
      return;
    }

    let filteredRows = rows.filter((row) => matchesProgramFilter(row.parent_summary));
    if (filteredRows.length === 0) {
      container.innerHTML = '<div class="empty-state">No timeline entries match the selected program.</div>';
      if (filterAdjusted) {
        renderEditableProjectsTable();
      }
      return;
    }

    // Apply sorting based on timelineSortMode
    if (timelineSortMode === 'program') {
      filteredRows = filteredRows.sort((a, b) => {
        const programA = (a.parent_summary || '').toLowerCase();
        const programB = (b.parent_summary || '').toLowerCase();
        if (programA < programB) return -1;
        if (programA > programB) return 1;
        // If programs are equal, sort by start date as secondary sort
        const startA = a.start_month || '';
        const startB = b.start_month || '';
        return startA.localeCompare(startB);
      });
    } else if (timelineSortMode === 'start_date') {
      filteredRows = filteredRows.sort((a, b) => {
        const startA = a.start_month || '';
        const startB = b.start_month || '';
        if (startA !== startB) {
          return startA.localeCompare(startB);
        }
        // If start dates are equal, sort by program as secondary sort
        const programA = (a.parent_summary || '').toLowerCase();
        const programB = (b.parent_summary || '').toLowerCase();
        return programA.localeCompare(programB);
      });
    }

    // Get all unique months represented in filtered rows
    const months = new Set();
    filteredRows.forEach((row) => {
      const start = row.start_month;
      const end = row.end_month;
      if (start) months.add(start);
      if (end) months.add(end);

      if (start && end) {
        let current = new Date(`${start}-01`);
        const endDate = new Date(`${end}-01`);
        while (current <= endDate) {
          const monthStr = current.toISOString().slice(0, 7);
          months.add(monthStr);
          current.setMonth(current.getMonth() + 1);
        }
      }
    });

    const sortedMonths = Array.from(months).sort();

    let html = '<div class="table-container"><table class="timeline-table">';
    html += '<thead><tr>';
    html += '<th class="project-col">Project</th>';
    sortedMonths.forEach((month) => {
      html += `<th>${month}</th>`;
    });
    html += '</tr></thead>';
    html += '<tbody>';

    filteredRows.forEach((row, rowIndex) => {
      const programName = row.parent_summary || '';
      const programColor = getProgramColor(programName, rowIndex);
      const rowBackground = getProgramBackground(programColor);
      const rowAttributes = ` data-program-color="${programColor}" data-project-id="${row.id || ''}" style="--program-color:${programColor}; --program-bg:${rowBackground};"`;

      const projectCellStyles = [];
      if (programColor) {
        projectCellStyles.push(`border-left: 4px solid ${programColor}`);
      }
      if (rowBackground) {
        projectCellStyles.push(`background:${rowBackground}`);
      }

      html += `<tr class="project-row"${rowAttributes}>`;
      html += `<td class="project-name expandable-project"${projectCellStyles.length ? ` style="cursor: pointer; ${projectCellStyles.join('; ')}"` : ' style="cursor: pointer;"'}>`;
      html += `<span class="expand-icon" style="display: inline-block; margin-right: 0.5rem; transition: transform 0.2s; font-size: 0.75rem;">▶</span>`;
      html += `${row.id || ''} - ${row.name || ''}<br>`;
      html += `<span class="project-details">`;
      html += `${programName || ''} | ${row.duration_months || '0'} month(s)`;
      html += `</span>`;
      html += `</td>`;

      sortedMonths.forEach((month) => {
        const start = row.start_month;
        const end = row.end_month;
        if (start && end && month >= start && month <= end) {
          let barClass = 'timeline-bar';
          if (month === start && month === end) {
            barClass += ' single';
          } else if (month === start) {
            barClass += ' start';
          } else if (month === end) {
            barClass += ' end';
          }

          const gradientStart = shadeColor(programColor, 0.12);
          const gradientEnd = shadeColor(programColor, -0.18);
          const barTextColor = getContrastingTextColor(programColor);
          const borderColor = shadeColor(programColor, -0.28);
          const barStyle = `background: linear-gradient(135deg, ${gradientStart}, ${gradientEnd}); color: ${barTextColor}; border-color: ${borderColor};`;
          html += `<td><div class="${barClass}" style="${barStyle}">●</div></td>`;
        } else {
          html += '<td></td>';
        }
      });

      html += '</tr>';

      // Add resource detail rows (hidden by default)
      if (cachedResourceAllocationData) {
        const projectResources = getProjectResources(row.id, sortedMonths);
        projectResources.forEach(resource => {
          html += `<tr class="resource-row" data-project-child="${row.id}" style="display: none; background: var(--gray-50);">`;
          html += `<td class="resource-name" style="padding-left: 3rem; font-size: 0.875rem; color: var(--gray-700);">`;
          html += `${resource.person} (${resource.role})`;
          html += `</td>`;

          sortedMonths.forEach((month) => {
            const alloc = resource.allocations[month] || 0;
            if (alloc > 0) {
              const percentage = Math.round(alloc * 100);
              html += `<td style="text-align: center; font-size: 0.75rem; color: var(--gray-600);">${percentage}%</td>`;
            } else {
              html += '<td></td>';
            }
          });

          html += '</tr>';
        });
      }
    });

    html += '</tbody></table></div>';

    // Add metadata banner at the top
    createResultsMetadata().then(metadataHtml => {
      if (metadataHtml) {
        container.innerHTML = metadataHtml + html;
      } else {
        container.innerHTML = html;
      }
      attachTimelineExpandHandlers(container);
    }).catch(() => {
      container.innerHTML = html;
      attachTimelineExpandHandlers(container);
    });

    if (filterAdjusted) {
      renderEditableProjectsTable();
    }
  }

  // Helper function to get resources assigned to a project
  function getProjectResources(projectId, months) {
    if (!cachedResourceAllocationData) return [];

    // Group by person AND role (since one person can have multiple roles on same project)
    const personRoleMap = new Map();

    cachedResourceAllocationData.forEach(row => {
      if (row.project_id === projectId && row.person) {
        // Use composite key: person|role
        const key = `${row.person}|${row.role || 'Unknown'}`;
        if (!personRoleMap.has(key)) {
          personRoleMap.set(key, {
            person: row.person,
            role: row.role || 'Unknown',
            allocations: {}
          });
        }
        const personData = personRoleMap.get(key);
        personData.allocations[row.month] = parseFloat(row.project_alloc_pct) || 0;
      }
    });

    return Array.from(personRoleMap.values());
  }

  // Attach expand/collapse handlers to timeline project rows
  function attachTimelineExpandHandlers(container) {
    const expandableProjects = container.querySelectorAll('.expandable-project');
    expandableProjects.forEach(projectCell => {
      projectCell.addEventListener('click', () => {
        const projectRow = projectCell.closest('tr');
        const projectId = projectRow.dataset.projectId;
        const expandIcon = projectCell.querySelector('.expand-icon');
        const resourceRows = container.querySelectorAll(`.resource-row[data-project-child="${projectId}"]`);

        const isExpanded = expandIcon.style.transform === 'rotate(90deg)';

        if (isExpanded) {
          // Collapse
          expandIcon.style.transform = '';
          resourceRows.forEach(row => row.style.display = 'none');
        } else {
          // Expand
          expandIcon.style.transform = 'rotate(90deg)';
          resourceRows.forEach(row => row.style.display = '');
        }
      });
    });
  }

  function rerenderTimelineFromCache() {
    const container = document.getElementById('projects-timeline-container');
    if (!container) return;
    if (cachedTimelineData && cachedTimelinePortfolio === selectedPortfolio) {
      renderProjectTimeline(cachedTimelineData, container);
    }
  }

  function refreshProjectVisuals() {
    const projectsInputSection = document.getElementById('projects-input');
    if (projectsInputSection && projectsInputSection.classList.contains('active') && projectsData.length > 0) {
      renderEditableProjectsTable();
    }

    const timelineSection = document.getElementById('projects-timeline');
    if (timelineSection && timelineSection.classList.contains('active')) {
      if (cachedTimelineData && cachedTimelinePortfolio === selectedPortfolio) {
        rerenderTimelineFromCache();
      } else {
        loadProjectsTimeline();
      }
    }

    const unallocatedSection = document.getElementById('projects-unallocated');
    if (unallocatedSection && unallocatedSection.classList.contains('active')) {
      loadUnallocatedProjects();
    }
  }

  const projectProgramFilterSelect = document.getElementById('project-program-filter');
  if (projectProgramFilterSelect) {
    projectProgramFilterSelect.addEventListener('change', handleProgramFilterChange);
  }

  const timelineProgramFilterSelect = document.getElementById('timeline-program-filter');
  if (timelineProgramFilterSelect) {
    timelineProgramFilterSelect.addEventListener('change', handleProgramFilterChange);
  }

  // Sort buttons for timeline
  const sortByProgramBtn = document.getElementById('sort-by-program-btn');
  if (sortByProgramBtn) {
    sortByProgramBtn.addEventListener('click', () => {
      timelineSortMode = 'program';
      rerenderTimelineFromCache();
    });
  }

  const sortByStartDateBtn = document.getElementById('sort-by-start-date-btn');
  if (sortByStartDateBtn) {
    sortByStartDateBtn.addEventListener('click', () => {
      timelineSortMode = 'start_date';
      rerenderTimelineFromCache();
    });
  }

  // Export timeline as PNG
  const exportTimelinePngBtn = document.getElementById('export-timeline-png-btn');
  if (exportTimelinePngBtn) {
    exportTimelinePngBtn.addEventListener('click', async () => {
      const container = document.getElementById('projects-timeline-container');
      if (!container || !cachedTimelineData || cachedTimelineData.length === 0) {
        alert('No timeline data to export. Please run the model first.');
        return;
      }

      try {
        exportTimelinePngBtn.disabled = true;
        exportTimelinePngBtn.innerHTML = '⏳ Generating...';

        // Fetch config to get friendly name
        let portfolioDisplayName = selectedPortfolio;
        try {
          const configResponse = await fetch(`/api/config/${selectedPortfolio}`);
          if (configResponse.ok) {
            const config = await configResponse.json();
            if (config.friendly_name && config.friendly_name.trim()) {
              portfolioDisplayName = config.friendly_name.trim();
            }
          }
        } catch (err) {
          console.log('Could not fetch friendly name, using portfolio ID');
        }

        // Create a wrapper with title and simplified metadata
        const exportWrapper = document.createElement('div');
        exportWrapper.style.cssText = 'background: white; padding: 2rem; width: fit-content;';

        // Add title
        const title = document.createElement('h2');
        title.textContent = `${portfolioDisplayName} - Project Timeline`;
        title.style.cssText = 'margin: 0 0 1rem 0; color: #1f2937; font-size: 1.5rem;';
        exportWrapper.appendChild(title);

        // Add simplified metadata (without solver/mode)
        const metadataHtml = await createResultsMetadata({ includeModelSettings: false });
        if (metadataHtml) {
          const metadataDiv = document.createElement('div');
          metadataDiv.innerHTML = metadataHtml;
          exportWrapper.appendChild(metadataDiv);
        }

        // Clone the timeline content
        const timelineClone = container.cloneNode(true);

        // Remove any existing metadata from the clone
        const existingMetadata = timelineClone.querySelector('.results-metadata');
        if (existingMetadata) {
          existingMetadata.remove();
        }

        timelineClone.style.cssText = 'margin-top: 1rem;';
        exportWrapper.appendChild(timelineClone);

        // Temporarily add to body for rendering
        exportWrapper.style.position = 'absolute';
        exportWrapper.style.left = '-9999px';
        exportWrapper.style.top = '0';
        document.body.appendChild(exportWrapper);

        // Get the full dimensions
        const fullWidth = exportWrapper.scrollWidth;
        const fullHeight = exportWrapper.scrollHeight;

        // Use html2canvas to capture the wrapper
        const canvas = await html2canvas(exportWrapper, {
          backgroundColor: '#ffffff',
          scale: 2, // Higher quality
          logging: false,
          useCORS: true,
          width: fullWidth,
          height: fullHeight,
          windowWidth: fullWidth,
          windowHeight: fullHeight,
          x: 0,
          y: 0
        });

        // Remove temporary wrapper
        document.body.removeChild(exportWrapper);

        // Convert to blob and download
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const portfolioName = selectedPortfolio || 'timeline';
          const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
          link.download = `${portfolioName}_timeline_${timestamp}.png`;
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);

          exportTimelinePngBtn.disabled = false;
          exportTimelinePngBtn.innerHTML = '📥 Export PNG';
        });

      } catch (err) {
        console.error('Error exporting timeline:', err);
        alert('Failed to export timeline. Please try again.');
        exportTimelinePngBtn.disabled = false;
        exportTimelinePngBtn.innerHTML = '📥 Export PNG';
      }
    });
  }

  updateProjectProgramFilterOptions();
  updateTimelineProgramFilterOptions([]);

  // Resourcing Recommendations
  let recommendationsChart = null;

  async function loadResourcingRecommendations() {
    const container = document.getElementById('resourcing-recommendations-container');
    if (!container) return;

    if (!selectedPortfolio) {
      container.innerHTML = '<div class="empty-state">Select a portfolio to view recommendations</div>';
      return;
    }

    container.innerHTML = '<div class="empty-state">Loading recommendations...</div>';

    try {
      const response = await fetch(`/files/${selectedPortfolio}/output/resourcing_recommendations.md`);
      if (!response.ok) {
        container.innerHTML = '<div class="empty-state">No recommendations available. Run the model in <strong>aggressive mode</strong> to generate hiring recommendations.</div>';
        return;
      }

      const markdownText = await response.text();

      // Parse out JSON chart data if present
      const jsonMatch = markdownText.match(/```json\n([\s\S]*?)\n```/);
      let chartData = null;
      let contentWithoutJson = markdownText;

      if (jsonMatch) {
        try {
          chartData = JSON.parse(jsonMatch[1]);
          // Remove JSON block from markdown
          contentWithoutJson = markdownText.replace(/## Capacity vs Demand Analysis[\s\S]*$/, '');
        } catch (e) {
          console.error('Failed to parse chart data:', e);
        }
      }

      // Render markdown using marked.js
      const htmlContent = marked.parse(contentWithoutJson);

      let html = `<div class="markdown-body" style="padding: 1rem;">${htmlContent}</div>`;

      // Add chart section if data is available
      if (chartData) {
        html += '<div style="padding: 1rem;"><h2>Capacity vs Demand Chart</h2>';
        html += '<div><canvas id="recommendations-chart" style="max-height: 400px;"></canvas></div>';
        html += '</div>';
      }

      container.innerHTML = html;

      // Render chart if data is available
      if (chartData) {
        renderRecommendationsChart(chartData);
      }
    } catch (err) {
      console.error('Error loading recommendations:', err);
      container.innerHTML = '<div class="empty-state">Error loading recommendations</div>';
    }
  }

  function renderRecommendationsChart(chartData) {
    // Destroy existing chart if any
    if (recommendationsChart) {
      recommendationsChart.destroy();
      recommendationsChart = null;
    }

    const canvas = document.getElementById('recommendations-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Prepare datasets for each role
    const datasets = [];
    const colors = {
      'BA': { capacity: 'rgba(54, 162, 235, 0.5)', demand: 'rgba(54, 162, 235, 1)' },
      'Dev': { capacity: 'rgba(255, 99, 132, 0.5)', demand: 'rgba(255, 99, 132, 1)' },
      'Planner': { capacity: 'rgba(75, 192, 192, 0.5)', demand: 'rgba(75, 192, 192, 1)' }
    };

    Object.keys(chartData).forEach(role => {
      const roleData = chartData[role];
      const months = roleData.map(d => d.month);
      const capacities = roleData.map(d => d.capacity);
      const demands = roleData.map(d => d.demand);

      const color = colors[role] || { capacity: 'rgba(201, 203, 207, 0.5)', demand: 'rgba(201, 203, 207, 1)' };

      datasets.push({
        label: `${role} Capacity`,
        data: capacities,
        borderColor: color.capacity,
        backgroundColor: color.capacity,
        borderWidth: 2,
        borderDash: [5, 5],
        fill: false,
      });

      datasets.push({
        label: `${role} Demand`,
        data: demands,
        borderColor: color.demand,
        backgroundColor: color.demand,
        borderWidth: 2,
        fill: false,
      });
    });

    // Get months from first role
    const firstRole = Object.keys(chartData)[0];
    const months = chartData[firstRole] ? chartData[firstRole].map(d => d.month) : [];

    recommendationsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: true,
            text: 'Capacity vs Demand by Role Over Time'
          },
          tooltip: {
            mode: 'index',
            intersect: false,
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Person-Months'
            }
          },
          x: {
            title: {
              display: true,
              text: 'Month'
            }
          }
        }
      }
    });
  }

  // Hook into subtab switching
  document.querySelectorAll('[data-subtab="people-recommendations"]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadResourcingRecommendations();
    });
  });

})();
