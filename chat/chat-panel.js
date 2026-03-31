// ==================== RAION Genspark Hub - 채팅 어시스턴트 패널 ====================

window.ChatPanel = (function() {
  'use strict';

  console.log('[ChatPanel] 로드됨');

  const $ = sel => document.querySelector(sel);
  const STORAGE_KEY = 'raion_chat_projects';
  const GROUPS_KEY = 'raion_chat_groups';
  const ORDER_KEY = 'raion_chat_order'; // 루트 레벨 순서 (groupId 또는 projectId)
  const SYNC_PROJECTS_KEY = 'raion_sync_projects';
  const SYNC_GROUPS_KEY = 'raion_sync_groups';
  const SYNC_ORDER_KEY = 'raion_sync_order';
  const BACKUP_HASH_KEY = 'raion_last_backup_hash';
  const HIDDEN_DEFAULTS_KEY = 'raion_hidden_defaults';

  let editingProjectId = null;
  let activeProjectId = null;

  // ==================== 참고 파일 상수 & 상태 ====================
  const MAX_REF_FILE_SIZE = 100 * 1024;
  const MAX_REF_TOTAL_SIZE = 500 * 1024;
  const MAX_REF_FILE_COUNT = 10;
  const ALLOWED_TEXT_EXTENSIONS = new Set([
    'txt','md','markdown','json','csv','tsv',
    'js','ts','jsx','tsx','py','java','c','cpp','h','cs',
    'html','css','scss','xml','yaml','yml','toml',
    'sh','bash','zsh','bat','ps1',
    'sql','graphql','gql',
    'log','cfg','ini','conf','properties',
    'r','rb','go','rs','swift','kt','scala','lua','pl'
  ]);
  let editingReferenceFiles = [];

  // ==================== Sync 헬퍼 ====================
  async function syncToCloud() {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, GROUPS_KEY, ORDER_KEY]);
      // sync 용량 제한(100KB)으로 referenceFiles 제외
      const projects = (result[STORAGE_KEY] || []).map(p => {
        const { referenceFiles, ...rest } = p;
        return rest;
      });
      const data = {
        [SYNC_PROJECTS_KEY]: projects,
        [SYNC_GROUPS_KEY]: result[GROUPS_KEY] || [],
        [SYNC_ORDER_KEY]: result[ORDER_KEY] || []
      };
      await chrome.storage.sync.set(data);
      console.log('[ChatPanel] sync 저장 완료');
    } catch (e) {
      console.warn('[ChatPanel] sync 저장 실패 (용량 초과 가능):', e.message);
    }
  }

  async function restoreFromSync() {
    try {
      const sync = await chrome.storage.sync.get([SYNC_PROJECTS_KEY, SYNC_GROUPS_KEY, SYNC_ORDER_KEY]);
      const projects = sync[SYNC_PROJECTS_KEY];
      if (projects && projects.length > 0) {
        console.log('[ChatPanel] sync에서 복원:', projects.length, '개 프로젝트');
        await chrome.storage.local.set({
          [STORAGE_KEY]: projects,
          [GROUPS_KEY]: sync[SYNC_GROUPS_KEY] || [],
          [ORDER_KEY]: sync[SYNC_ORDER_KEY] || []
        });
        return true;
      }
    } catch (e) {
      console.warn('[ChatPanel] sync 복원 실패:', e.message);
    }
    return false;
  }

  async function seedFromDefaults() {
    try {
      const res = await fetch(chrome.runtime.getURL('data/default-projects.json'));
      const data = await res.json();
      const projects = data.projects || [];
      if (projects.length === 0) return false;
      // v2 포맷: groups, order 포함
      const groups = data.groups || [];
      const order = data.order || projects.map(p => p.id);
      console.log('[ChatPanel] default-projects.json에서 시딩:', projects.length, '개 프로젝트');
      await chrome.storage.local.set({
        [STORAGE_KEY]: projects,
        [GROUPS_KEY]: groups,
        [ORDER_KEY]: order
      });
      return true;
    } catch (e) {
      console.warn('[ChatPanel] 시딩 실패:', e.message);
      return false;
    }
  }

  async function initializeData() {
    // 1. local에 데이터 있으면 그대로 사용
    const local = await chrome.storage.local.get(STORAGE_KEY);
    if (local[STORAGE_KEY] && local[STORAGE_KEY].length > 0) return;

    // 2. sync에서 복원 시도
    if (await restoreFromSync()) return;

    // 3. default-projects.json에서 시딩
    await seedFromDefaults();
  }

  // ==================== 내보내기/가져오기 ====================
  async function exportProjects() {
    const result = await chrome.storage.local.get([STORAGE_KEY, GROUPS_KEY, ORDER_KEY]);
    const data = {
      version: 2,
      projects: result[STORAGE_KEY] || [],
      groups: result[GROUPS_KEY] || [],
      order: result[ORDER_KEY] || [],
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'raion-genspark-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log('[ChatPanel] 내보내기 완료');
  }

  async function mergeImportedData(data) {
    if (!data.projects || !Array.isArray(data.projects)) {
      alert('유효하지 않은 데이터입니다.');
      return false;
    }

    const existingProjects = await ProjectManager.getUserProjects();
    const existingGroups = await GroupManager.getAll();
    const existingOrder = await getOrder();
    const existingIds = new Set(existingProjects.map(p => p.id));

    const newProjects = data.projects.filter(p => !existingIds.has(p.id));
    if (newProjects.length === 0) {
      alert('추가할 새 프로젝트가 없습니다.\n(모두 이미 존재합니다)');
      return false;
    }
    if (!confirm(`${newProjects.length}개 프로젝트를 추가합니다.`)) return false;

    const mergedProjects = [...existingProjects, ...newProjects];
    await chrome.storage.local.set({ [STORAGE_KEY]: mergedProjects });

    const existingGroupIds = new Set(existingGroups.map(g => g.id));
    const newGroups = (data.groups || []).filter(g => !existingGroupIds.has(g.id));
    if (newGroups.length > 0) {
      await chrome.storage.local.set({ [GROUPS_KEY]: [...existingGroups, ...newGroups] });
    }

    const orderSet = new Set(existingOrder);
    const newOrderItems = (data.order || newProjects.map(p => p.id)).filter(id => !orderSet.has(id));
    if (newOrderItems.length > 0) {
      await saveOrder([...existingOrder, ...newOrderItems]);
    }

    await syncToCloud();
    console.log('[ChatPanel] 가져오기 완료:', newProjects.length, '개 추가');
    renderProjectList();
    return true;
  }

  async function importProjects() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        await mergeImportedData(data);
      } catch (err) {
        alert('파일을 읽을 수 없습니다: ' + err.message);
      }
    });
    input.click();
  }

  async function importProjectsFromURL() {
    const url = prompt('프로젝트 JSON URL을 입력하세요:');
    if (!url || !url.trim()) return;
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await mergeImportedData(data);
    } catch (err) {
      alert('URL에서 가져올 수 없습니다: ' + err.message);
    }
  }

  async function deleteAllProjects() {
    if (!confirm('모든 프로젝트와 그룹을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    if (!confirm('정말 전체 삭제하시겠습니까?')) return;
    // 기본 프로젝트 숨김 처리
    const defaults = await ProjectManager.getDefaults();
    const hiddenIds = defaults.map(d => d.id);
    await chrome.storage.local.set({
      [STORAGE_KEY]: [],
      [GROUPS_KEY]: [],
      [ORDER_KEY]: [],
      [HIDDEN_DEFAULTS_KEY]: hiddenIds
    });
    if (activeProjectId) {
      chrome.runtime.sendMessage({ type: 'CHAT_DEACTIVATE' });
      activeProjectId = null;
    }
    await syncToCloud();
    renderProjectList();
  }

  // ==================== ProjectManager ====================
  const ProjectManager = {
    async getDefaults() {
      try {
        const res = await fetch(chrome.runtime.getURL('data/default-projects.json'));
        const data = await res.json();
        return (data.projects || []).map(p => ({ ...p, isDefault: true }));
      } catch (e) { return []; }
    },

    async getUserProjects() {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || [];
    },

    async getAll() {
      const defaults = await this.getDefaults();
      const userProjects = await this.getUserProjects();
      const overriddenIds = new Set(userProjects.filter(p => p.overrideDefault).map(p => p.overrideDefault));
      const hidden = await chrome.storage.local.get(HIDDEN_DEFAULTS_KEY);
      const hiddenIds = new Set(hidden[HIDDEN_DEFAULTS_KEY] || []);
      const filteredDefaults = defaults.filter(d => !overriddenIds.has(d.id) && !hiddenIds.has(d.id));
      return [...filteredDefaults, ...userProjects];
    },

    async create(project) {
      const projects = await this.getUserProjects();
      project.id = crypto.randomUUID();
      project.isDefault = false;
      project.createdAt = Date.now();
      project.updatedAt = Date.now();
      projects.push(project);
      await chrome.storage.local.set({ [STORAGE_KEY]: projects });
      // 루트 순서에 추가
      const order = await getOrder();
      order.push(project.id);
      await saveOrder(order);
      syncToCloud();
      return project;
    },

    async update(id, changes) {
      const projects = await this.getUserProjects();
      const idx = projects.findIndex(p => p.id === id);
      if (idx >= 0) {
        Object.assign(projects[idx], changes, { updatedAt: Date.now() });
        await chrome.storage.local.set({ [STORAGE_KEY]: projects });
        syncToCloud();
        return projects[idx];
      }
      const defaults = await this.getDefaults();
      const defaultProject = defaults.find(p => p.id === id);
      if (defaultProject) {
        const userCopy = { ...defaultProject, ...changes, id: crypto.randomUUID(), isDefault: false, overrideDefault: defaultProject.id, updatedAt: Date.now() };
        projects.push(userCopy);
        await chrome.storage.local.set({ [STORAGE_KEY]: projects });
        // 순서에서 원본 ID를 새 ID로 교체
        await replaceInOrder(id, userCopy.id);
        syncToCloud();
        return userCopy;
      }
      return null;
    },

    async delete(id) {
      // 기본 프로젝트인 경우 숨김 처리
      const defaults = await this.getDefaults();
      if (defaults.some(d => d.id === id)) {
        const hidden = await chrome.storage.local.get(HIDDEN_DEFAULTS_KEY);
        const hiddenIds = hidden[HIDDEN_DEFAULTS_KEY] || [];
        hiddenIds.push(id);
        await chrome.storage.local.set({ [HIDDEN_DEFAULTS_KEY]: hiddenIds });
      }
      let projects = await this.getUserProjects();
      projects = projects.filter(p => p.id !== id);
      await chrome.storage.local.set({ [STORAGE_KEY]: projects });
      await removeFromOrder(id);
      syncToCloud();
    }
  };

  // ==================== GroupManager ====================
  const GroupManager = {
    async getAll() {
      const result = await chrome.storage.local.get(GROUPS_KEY);
      return result[GROUPS_KEY] || [];
    },

    async create(name) {
      const groups = await this.getAll();
      const group = { id: crypto.randomUUID(), name, projectIds: [], isOpen: true };
      groups.push(group);
      await chrome.storage.local.set({ [GROUPS_KEY]: groups });
      const order = await getOrder();
      order.push(group.id);
      await saveOrder(order);
      syncToCloud();
      return group;
    },

    async update(id, changes) {
      const groups = await this.getAll();
      const g = groups.find(g => g.id === id);
      if (g) { Object.assign(g, changes); await chrome.storage.local.set({ [GROUPS_KEY]: groups }); syncToCloud(); }
    },

    async delete(id) {
      let groups = await this.getAll();
      const group = groups.find(g => g.id === id);
      groups = groups.filter(g => g.id !== id);
      await chrome.storage.local.set({ [GROUPS_KEY]: groups });
      // 그룹 내 프로젝트를 루트로 이동
      const order = await getOrder();
      const idx = order.indexOf(id);
      if (idx >= 0) {
        order.splice(idx, 1, ...(group?.projectIds || []));
        await saveOrder(order);
      }
      syncToCloud();
    },

    async toggleOpen(id) {
      const groups = await this.getAll();
      const g = groups.find(g => g.id === id);
      if (g) { g.isOpen = !g.isOpen; await chrome.storage.local.set({ [GROUPS_KEY]: groups }); }
      // toggleOpen은 UI 상태만이므로 sync 안 함
    },

    async addProject(groupId, projectId) {
      const groups = await this.getAll();
      const g = groups.find(g => g.id === groupId);
      if (g && !g.projectIds.includes(projectId)) {
        g.projectIds.push(projectId);
        await chrome.storage.local.set({ [GROUPS_KEY]: groups });
        syncToCloud();
      }
    },

    async removeProject(groupId, projectId) {
      const groups = await this.getAll();
      const g = groups.find(g => g.id === groupId);
      if (g) {
        g.projectIds = g.projectIds.filter(id => id !== projectId);
        await chrome.storage.local.set({ [GROUPS_KEY]: groups });
        syncToCloud();
      }
    }
  };

  // ==================== 순서 관리 ====================
  async function getOrder() {
    const result = await chrome.storage.local.get(ORDER_KEY);
    return result[ORDER_KEY] || [];
  }

  async function saveOrder(order) {
    await chrome.storage.local.set({ [ORDER_KEY]: order });
  }

  async function removeFromOrder(id) {
    const order = await getOrder();
    const newOrder = order.filter(x => x !== id);
    await saveOrder(newOrder);
  }

  async function replaceInOrder(oldId, newId) {
    const order = await getOrder();
    const idx = order.indexOf(oldId);
    if (idx >= 0) order[idx] = newId;
    await saveOrder(order);
    const groups = await GroupManager.getAll();
    for (const g of groups) {
      const i = g.projectIds.indexOf(oldId);
      if (i >= 0) g.projectIds[i] = newId;
    }
    await chrome.storage.local.set({ [GROUPS_KEY]: groups });
  }

  // ==================== 초기화 ====================
  async function init() {
    console.log('[ChatPanel] 초기화');
    await initializeData();
    setupEvents();
    setupMessageListener();
    renderProjectList();
    restoreChatState();
    setupPageCheckListeners();
  }

  function setupPageCheckListeners() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url && !changeInfo.url.includes('genspark.ai/agents')) {
        deactivateIfActive();
      }
    });
  }

  function deactivateIfActive() {
    if (activeProjectId) {
      chrome.runtime.sendMessage({ type: 'CHAT_DEACTIVATE' });
      activeProjectId = null;
      renderProjectList();
    }
  }

  // ==================== 이벤트 설정 ====================
  function setupEvents() {
    $('#chat-back-btn').addEventListener('click', () => window.navigateToHome());
    $('#btn-add-project').addEventListener('click', () => showProjectForm(null));
    $('#btn-add-group').addEventListener('click', createGroup);
    $('#btn-export-projects').addEventListener('click', exportProjects);
    $('#btn-import-projects').addEventListener('click', importProjects);
    $('#btn-import-url').addEventListener('click', importProjectsFromURL);
    $('#btn-delete-all').addEventListener('click', deleteAllProjects);
    $('#form-back-btn').addEventListener('click', () => showProjectList());
    $('#btn-save-project').addEventListener('click', saveProject);
    $('#btn-delete-project').addEventListener('click', deleteProject);
    $('#project-system-prompt').addEventListener('input', () => {
      $('#prompt-char-count').textContent = `${$('#project-system-prompt').value.length}자`;
    });
    // 참고 파일
    $('#ref-files-dropzone').addEventListener('click', addReferenceFile);
    const refContainer = $('#ref-files-container');
    refContainer.addEventListener('dragover', (e) => { e.preventDefault(); refContainer.classList.add('drag-over'); });
    refContainer.addEventListener('dragleave', () => refContainer.classList.remove('drag-over'));
    refContainer.addEventListener('drop', (e) => { e.preventDefault(); refContainer.classList.remove('drag-over'); handleFileDrop(e.dataTransfer.files); });
  }

  async function createGroup() {
    const name = prompt('그룹 이름을 입력하세요:');
    if (!name || !name.trim()) return;
    await GroupManager.create(name.trim());
    renderProjectList();
  }

  // ==================== 뷰 전환 ====================
  function showProjectList() {
    $('#chat-project-list-view').style.display = 'flex';
    $('#chat-project-form-view').style.display = 'none';
    renderProjectList();
  }

  function showProjectForm(project) {
    $('#chat-project-list-view').style.display = 'none';
    $('#chat-project-form-view').style.display = 'flex';
    if (project) {
      editingProjectId = project.id;
      $('#form-title').textContent = '프로젝트 편집';
      $('#project-name').value = project.name || '';
      $('#project-description').value = project.description || '';
      $('#project-model').value = project.model || 'Claude Sonnet 4.6';
      $('#project-system-prompt').value = project.systemPrompt || '';
      $('#prompt-char-count').textContent = `${(project.systemPrompt || '').length}자`;
      $('#btn-delete-project').style.display = (project.isDefault && !project.overrideDefault) ? 'none' : 'block';
      editingReferenceFiles = JSON.parse(JSON.stringify(project.referenceFiles || []));
    } else {
      editingProjectId = null;
      $('#form-title').textContent = '새 프로젝트';
      $('#project-name').value = '';
      $('#project-description').value = '';
      $('#project-model').value = 'Claude Sonnet 4.6';
      $('#project-system-prompt').value = '';
      $('#prompt-char-count').textContent = '0자';
      $('#btn-delete-project').style.display = 'none';
      editingReferenceFiles = [];
    }
    renderReferenceFiles();
  }

  // ==================== 렌더링 ====================
  async function renderProjectList() {
    const allProjects = await ProjectManager.getAll();
    const groups = await GroupManager.getAll();
    let order = await getOrder();
    const projectMap = {};
    allProjects.forEach(p => { projectMap[p.id] = p; });
    const groupMap = {};
    groups.forEach(g => { groupMap[g.id] = g; });

    // 그룹에 속한 프로젝트 ID 수집
    const groupedProjectIds = new Set();
    groups.forEach(g => g.projectIds.forEach(id => groupedProjectIds.add(id)));

    // 순서에 없고 그룹에도 없는 프로젝트를 order 끝에 추가
    const allIds = new Set(order);
    allProjects.forEach(p => {
      if (!allIds.has(p.id) && !groupedProjectIds.has(p.id)) {
        order.push(p.id);
      }
    });

    const listEl = $('#project-list');
    let html = '';

    for (const itemId of order) {
      const group = groupMap[itemId];
      if (group) {
        html += renderGroup(group, projectMap);
      } else if (!groupedProjectIds.has(itemId)) {
        // 그룹에 속한 프로젝트는 루트에 표시하지 않음
        const project = projectMap[itemId];
        if (project) {
          html += renderProjectCard(project, null);
        }
      }
    }

    if (!html) {
      html = '<div class="chat-empty-state"><p>프로젝트가 없습니다.<br>새 프로젝트를 만들어보세요.</p></div>';
    }

    listEl.innerHTML = html;
    bindCardEvents(listEl);
    setupDragAndDrop(listEl);
  }

  function renderGroup(group, projectMap) {
    const projects = group.projectIds.map(id => projectMap[id]).filter(Boolean);
    return `
    <div class="project-group" data-group-id="${group.id}" data-drop-group="${group.id}">
      <div class="group-header" data-group-id="${group.id}" data-drop-group="${group.id}">
        <div class="group-drag-handle" title="드래그하여 이동">⠿</div>
        <div class="group-toggle ${group.isOpen ? 'open' : ''}" data-group-id="${group.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <svg class="group-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="group-name">${escapeHtml(group.name)}</span>
        <span class="group-count">${projects.length}</span>
        <button class="group-menu-btn" data-group-id="${group.id}" title="그룹 메뉴">⋯</button>
      </div>
      <div class="group-body ${group.isOpen ? 'open' : ''}" data-group-id="${group.id}">
        ${projects.map(p => renderProjectCard(p, group.id)).join('')}
        ${projects.length === 0 ? '<div class="group-empty" data-drop-group="' + group.id + '">프로젝트를 여기에 놓으세요</div>' : ''}
      </div>
    </div>`;
  }

  function renderProjectCard(project, groupId) {
    const p = project;
    const isActive = activeProjectId === p.id;
    return `
    <div class="project-card ${isActive ? 'active-project' : ''}" data-id="${p.id}" data-project-id="${p.id}"${groupId ? ` data-group-id="${groupId}"` : ''}>
      <div class="drag-handle" title="드래그하여 이동">⠿</div>
      <div class="project-card-content">
        <div class="project-card-header">
          <span class="project-card-name">${escapeHtml(p.name)}${p.isDefault ? '<span class="project-card-default-badge">기본</span>' : ''}${(p.referenceFiles && p.referenceFiles.length > 0) ? `<span class="ref-files-badge">${p.referenceFiles.length}개 파일</span>` : ''}<span class="project-card-type-badge">프로젝트</span></span>
          <span class="project-card-model">${escapeHtml(p.model || '')}</span>
        </div>
        <div class="project-card-desc">${escapeHtml(p.description || '')}</div>
        <div class="project-card-actions">
          ${isActive ? `
            <button class="btn-project-activate btn-deactivate" data-id="${p.id}">비활성화</button>
          ` : `
            <div class="btn-activate-group" data-id="${p.id}">
              <button class="btn-project-activate btn-activate-toggle" data-id="${p.id}">활성화 ▾</button>
              <div class="activate-dropdown">
                <div class="activate-option" data-mode="new">
                  <span class="activate-option-label">새 채팅 시작</span>
                  <span class="activate-option-desc">새 대화 + 모델 설정 + 지침서</span>
                </div>
                <div class="activate-option" data-mode="continue">
                  <span class="activate-option-label">이어서 진행</span>
                  <span class="activate-option-desc">현재 채팅에 지침서 추가</span>
                </div>
              </div>
            </div>
          `}
          <button class="btn-project-edit" data-id="${p.id}">편집</button>
          <button class="btn-project-delete" data-id="${p.id}">삭제</button>
        </div>
        ${isActive ? '<div class="project-card-status status-ready">준비 완료 - 채팅 가능</div>' : ''}
      </div>
    </div>`;
  }

  // ==================== 카드 이벤트 바인딩 ====================
  function bindCardEvents(listEl) {
    // 드롭다운 토글
    listEl.querySelectorAll('.btn-activate-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 다른 드롭다운 닫기
        listEl.querySelectorAll('.activate-dropdown.show').forEach(d => d.classList.remove('show'));
        const group = btn.closest('.btn-activate-group');
        const dropdown = group.querySelector('.activate-dropdown');
        if (dropdown.classList.contains('show')) {
          dropdown.classList.remove('show');
        } else {
          // 버튼 위치 기준으로 fixed 위치 설정
          const rect = btn.getBoundingClientRect();
          dropdown.style.left = rect.left + 'px';
          dropdown.style.top = (rect.bottom + 4) + 'px';
          dropdown.style.width = rect.width + 'px';
          dropdown.classList.add('show');
        }
      });
    });

    // 드롭다운 옵션
    listEl.querySelectorAll('.activate-option').forEach(option => {
      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mode = option.dataset.mode;
        const id = option.closest('.btn-activate-group').dataset.id;
        option.closest('.activate-dropdown').classList.remove('show');
        const all = await ProjectManager.getAll();
        const project = all.find(p => p.id === id);
        if (project) activateProject(project, mode);
      });
    });

    // 비활성화
    listEl.querySelectorAll('.btn-deactivate').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'CHAT_DEACTIVATE' });
        activeProjectId = null;
        renderProjectList();
      });
    });

    // 편집
    listEl.querySelectorAll('.btn-project-edit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const all = await ProjectManager.getAll();
        const project = all.find(p => p.id === btn.dataset.id);
        if (project) showProjectForm(project);
      });
    });

    // 삭제
    listEl.querySelectorAll('.btn-project-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const all = await ProjectManager.getAll();
        const project = all.find(p => p.id === id);
        if (!project) return;
        if (!confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
        if (activeProjectId === id) {
          chrome.runtime.sendMessage({ type: 'CHAT_DEACTIVATE' });
          activeProjectId = null;
        }
        await ProjectManager.delete(id);
        renderProjectList();
      });
    });

    // 그룹 토글
    listEl.querySelectorAll('.group-toggle').forEach(toggle => {
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        await GroupManager.toggleOpen(toggle.dataset.groupId);
        renderProjectList();
      });
    });

    // 그룹 헤더 클릭 (토글)
    listEl.querySelectorAll('.group-header').forEach(header => {
      header.addEventListener('click', async () => {
        await GroupManager.toggleOpen(header.dataset.groupId);
        renderProjectList();
      });
    });

    // 그룹 메뉴
    listEl.querySelectorAll('.group-menu-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const groupId = btn.dataset.groupId;
        const action = prompt('그룹 관리:\n1: 이름 변경\n2: 그룹 삭제 (프로젝트는 유지)');
        if (action === '1') {
          const name = prompt('새 그룹 이름:');
          if (name) { await GroupManager.update(groupId, { name: name.trim() }); renderProjectList(); }
        } else if (action === '2') {
          await GroupManager.delete(groupId);
          renderProjectList();
        }
      });
    });

    // 바깥 클릭 시 드롭다운 닫기
    document.addEventListener('click', () => {
      listEl.querySelectorAll('.activate-dropdown.show').forEach(d => d.classList.remove('show'));
    });
  }

  // ==================== 드래그 앤 드롭 ====================
  let drag = null;

  // 이벤트 위임: #project-list에 한 번만 등록 (re-render에도 유지)
  let dragDelegationSetup = false;
  function setupDragAndDrop(listEl) {
    if (dragDelegationSetup) return;
    dragDelegationSetup = true;

    listEl.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.drag-handle');
      const groupHandle = e.target.closest('.group-drag-handle');

      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        const card = handle.closest('.project-card');
        if (!card) return;
        console.log('[Drag] 프로젝트 핸들 mousedown', card.dataset.projectId);
        initDrag(e, card, 'project', { projectId: card.dataset.projectId, fromGroupId: card.dataset.groupId || null });
      } else if (groupHandle) {
        e.preventDefault();
        e.stopPropagation();
        const group = groupHandle.closest('.project-group');
        if (!group) return;
        console.log('[Drag] 그룹 핸들 mousedown', group.dataset.groupId);
        initDrag(e, group, 'group', { groupId: group.dataset.groupId });
      }
    });
  }

  function initDrag(e, el, type, data) {
    drag = { type, el, data, startX: e.clientX, startY: e.clientY, ghost: null, started: false };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  }

  function onDragMove(e) {
    if (!drag) return;

    // 5px 이상 움직여야 드래그 시작
    if (!drag.started) {
      if (Math.abs(e.clientY - drag.startY) < 5 && Math.abs(e.clientX - drag.startX) < 5) return;
      drag.started = true;

      // 고스트 생성 (작게 축소)
      const rect = drag.el.getBoundingClientRect();
      drag.ghost = drag.el.cloneNode(true);
      drag.ghost.className = 'drag-ghost';
      drag.ghost.style.width = (rect.width * 0.85) + 'px';
      drag.ghost.style.position = 'fixed';
      drag.ghost.style.pointerEvents = 'none';
      drag.ghost.style.zIndex = '9999';
      document.body.appendChild(drag.ghost);

      drag.el.classList.add('dragging');
      drag.offsetX = e.clientX - rect.left;
      drag.offsetY = e.clientY - rect.top;
    }

    // 고스트 위치
    drag.ghost.style.left = (e.clientX - drag.offsetX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offsetY) + 'px';

    // 하이라이트
    clearHighlights();
    const target = hitTest(e.clientX, e.clientY);
    if (target) {
      if (target.type === 'group') target.el.classList.add('drag-over');
      if (target.type === 'card') target.el.classList.add(target.above ? 'drag-above' : 'drag-below');
    }
  }

  function hitTest(x, y) {
    if (!drag) return null;
    const listEl = $('#project-list');

    // 1. 그룹 헤더 체크 (최우선 - 헤더 위에 놓으면 그룹에 넣기)
    for (const header of listEl.querySelectorAll('.group-header')) {
      const r = header.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const group = header.closest('.project-group');
        return { type: 'group', el: group, groupId: header.dataset.groupId };
      }
    }

    // 2. 그룹 빈 영역 체크 (열린 그룹의 빈 공간)
    for (const empty of listEl.querySelectorAll('.group-empty')) {
      const r = empty.getBoundingClientRect();
      if (r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const group = empty.closest('.project-group');
        return { type: 'group', el: group, groupId: empty.dataset.dropGroup };
      }
    }

    // 3. 그룹 바디 빈 공간 (카드 아래 영역)
    for (const body of listEl.querySelectorAll('.group-body.open')) {
      const r = body.getBoundingClientRect();
      if (r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        // 바디 안에 카드가 없는 영역인지 확인
        let onCard = false;
        for (const card of body.querySelectorAll('.project-card')) {
          const cr = card.getBoundingClientRect();
          if (y >= cr.top && y <= cr.bottom) { onCard = true; break; }
        }
        if (!onCard) {
          const group = body.closest('.project-group');
          return { type: 'group', el: group, groupId: body.dataset.groupId };
        }
      }
    }

    // 4. 프로젝트 카드 체크 (순서 변경) - 가장 가까운 카드 찾기
    let closestCard = null;
    let closestDist = Infinity;

    for (const card of listEl.querySelectorAll('.project-card:not(.dragging)')) {
      const r = card.getBoundingClientRect();
      // 좌우 범위 안에 있는지만 체크 (상하는 거리 기반)
      if (x < r.left - 10 || x > r.right + 10) continue;

      const cardCenterY = r.top + r.height / 2;
      const dist = Math.abs(y - cardCenterY);

      // 카드 높이의 1.5배 이내에 있으면 후보
      if (dist < r.height * 1.5 && dist < closestDist) {
        closestDist = dist;
        closestCard = { type: 'card', el: card, above: y < cardCenterY, projectId: card.dataset.projectId, groupId: card.dataset.groupId || null };
      }
    }

    return closestCard;
  }

  function clearHighlights() {
    const listEl = $('#project-list');
    if (!listEl) return;
    listEl.querySelectorAll('.drag-above, .drag-below, .drag-over').forEach(el => {
      el.classList.remove('drag-above', 'drag-below', 'drag-over');
    });
  }

  async function onDragUp(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);

    if (!drag) return;

    const wasStarted = drag.started;
    const { type, data } = drag;

    if (!wasStarted) {
      drag.ghost?.remove();
      drag = null;
      return;
    }

    // hitTest를 dragging 해제 전에 실행 (원본 카드가 감지되지 않도록)
    const target = hitTest(e.clientX, e.clientY);
    console.log('[Drag] 드롭:', target?.type, target?.groupId || target?.projectId);

    // 정리
    drag.ghost?.remove();
    drag.el?.classList.remove('dragging');
    clearHighlights();
    drag = null;

    if (!target) {
      // 빈 공간에 놓으면 → 그룹에서 빼서 루트로 이동
      if (type === 'project' && data.fromGroupId) {
        console.log('[Drag] 빈 공간 드롭 → 루트로 이동');
        await GroupManager.removeProject(data.fromGroupId, data.projectId);
        const order = await getOrder();
        order.push(data.projectId);
        await saveOrder(order);
        renderProjectList();
      }
      return;
    }

    // ===== 그룹 드래그: 순서 변경 =====
    if (type === 'group' && data.groupId) {
      const order = await getOrder();
      const curIdx = order.indexOf(data.groupId);
      if (curIdx < 0) return;

      if (target.type === 'card' || target.type === 'group') {
        const targetId = target.groupId || target.projectId;
        const targetIdx = order.indexOf(targetId);
        if (targetIdx < 0 || targetId === data.groupId) return;
        order.splice(curIdx, 1);
        const newIdx = order.indexOf(targetId);
        order.splice(target.above !== undefined && target.above ? newIdx : newIdx + 1, 0, data.groupId);
        await saveOrder(order);
      }
      renderProjectList();
      return;
    }

    // ===== 프로젝트 드래그 =====
    const sourceId = data.projectId;
    const fromGroupId = data.fromGroupId;
    if (!sourceId) return;

    if (target.type === 'group') {
      // 그룹에 드롭
      console.log('[Drag] 그룹 드롭 실행:', sourceId, '→', target.groupId, 'from:', fromGroupId);
      if (fromGroupId === target.groupId) { console.log('[Drag] 같은 그룹 - 스킵'); renderProjectList(); return; }

      // 루트 순서에서 제거
      if (fromGroupId) {
        await GroupManager.removeProject(fromGroupId, sourceId);
      } else {
        const order = await getOrder();
        console.log('[Drag] 순서에서 제거 전:', order);
        const newOrder = order.filter(x => x !== sourceId);
        console.log('[Drag] 순서에서 제거 후:', newOrder);
        await saveOrder(newOrder);
      }

      // 그룹에 추가
      await GroupManager.addProject(target.groupId, sourceId);

      // 검증
      const groups = await GroupManager.getAll();
      const g = groups.find(g => g.id === target.groupId);
      console.log('[Drag] 그룹 추가 후 projectIds:', g?.projectIds);
    } else if (target.type === 'card') {
      // 카드 사이에 드롭
      const targetId = target.projectId;
      if (targetId === sourceId) return;

      // 원래 위치에서 제거
      if (fromGroupId) await GroupManager.removeProject(fromGroupId, sourceId);
      else { const order = await getOrder(); await saveOrder(order.filter(x => x !== sourceId)); }

      // 새 위치에 삽입
      if (target.groupId) {
        const groups = await GroupManager.getAll();
        const g = groups.find(g => g.id === target.groupId);
        if (g) {
          const idx = g.projectIds.indexOf(targetId);
          g.projectIds.splice(target.above ? idx : idx + 1, 0, sourceId);
          await chrome.storage.local.set({ [GROUPS_KEY]: groups });
        }
      } else {
        const order = await getOrder();
        const idx = order.indexOf(targetId);
        order.splice(target.above ? idx : idx + 1, 0, sourceId);
        await saveOrder(order);
      }
    }

    renderProjectList();
  }

  // ==================== CRUD ====================
  async function saveProject() {
    const name = $('#project-name').value.trim();
    const description = $('#project-description').value.trim();
    const model = $('#project-model').value;
    const systemPrompt = $('#project-system-prompt').value.trim();
    if (!name) { alert('프로젝트 이름을 입력해주세요.'); return; }
    if (!systemPrompt) { alert('지침서를 입력해주세요.'); return; }
    const data = { name, description, model, systemPrompt, referenceFiles: editingReferenceFiles };
    if (editingProjectId) {
      await ProjectManager.update(editingProjectId, data);
    } else {
      await ProjectManager.create(data);
    }
    showProjectList();
  }

  async function deleteProject() {
    if (!editingProjectId) return;
    if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return;
    await ProjectManager.delete(editingProjectId);
    editingProjectId = null;
    showProjectList();
  }

  // ==================== 프로젝트 활성화 ====================
  function activateProject(project, mode = 'new') {
    activeProjectId = project.id;
    updateProjectCardStatus(project.id, 'activating', mode === 'new' ? '새 채팅 준비 중...' : '지침서 전송 준비 중...');
    chrome.runtime.sendMessage({ type: 'CHAT_ACTIVATE_PROJECT', project, mode });
  }

  function updateProjectCardStatus(projectId, status, message) {
    const card = document.querySelector(`.project-card[data-id="${projectId}"]`);
    if (!card) return;
    document.querySelectorAll('.project-card-status').forEach(el => el.remove());
    document.querySelectorAll('.project-card.active-project').forEach(el => el.classList.remove('active-project'));
    if (status === 'idle') return;
    card.classList.add('active-project');
    const statusEl = document.createElement('div');
    statusEl.className = `project-card-status status-${status}`;
    statusEl.textContent = message;
    card.querySelector('.project-card-content')?.appendChild(statusEl) || card.appendChild(statusEl);
    const activateBtn = card.querySelector('.btn-project-activate');
    if (activateBtn && status === 'activating') {
      activateBtn.textContent = '활성화 중...';
      activateBtn.disabled = true;
    }
  }

  // ==================== 상태 복원 ====================
  async function restoreChatState() {
    const { chatAutomationState } = await chrome.storage.local.get('chatAutomationState');
    if (chatAutomationState?.activeProject && chatAutomationState.status === 'ready') {
      activeProjectId = chatAutomationState.activeProject.id;
      setTimeout(() => updateProjectCardStatus(activeProjectId, 'ready', '준비 완료 - 채팅 가능'), 100);
    }
  }

  // ==================== 메시지 수신 ====================
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'CHAT_STATUS_UPDATE':
          if (!activeProjectId) break;
          switch (msg.status) {
            case 'ready': updateProjectCardStatus(activeProjectId, 'ready', '준비 완료 - 채팅 가능'); break;
            case 'error':
              updateProjectCardStatus(activeProjectId, 'error', msg.message);
              setTimeout(() => { if (activeProjectId) { updateProjectCardStatus(activeProjectId, 'idle', ''); activeProjectId = null; renderProjectList(); } }, 5000);
              break;
            case 'injecting': updateProjectCardStatus(activeProjectId, 'activating', msg.message || '설정 중...'); break;
            case 'waiting_ack': updateProjectCardStatus(activeProjectId, 'activating', 'AI 응답 대기 중...'); break;
            default: updateProjectCardStatus(activeProjectId, 'activating', msg.message || '처리 중...');
          }
          break;
        case 'AUTH_REQUIRED':
          if (activeProjectId) updateProjectCardStatus(activeProjectId, 'error', '인증이 필요합니다');
          break;
      }
    });
  }

  // ==================== 참고 파일 관리 ====================
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    return (bytes / 1024).toFixed(1) + 'KB';
  }

  function getFileExtension(filename) {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  }

  function getTotalRefSize() {
    return editingReferenceFiles.reduce((sum, f) => sum + f.size, 0);
  }

  function renderReferenceFiles() {
    const listEl = $('#ref-files-list');
    const usageEl = $('#ref-files-usage');
    if (!listEl || !usageEl) return;

    listEl.innerHTML = editingReferenceFiles.map(file => `
      <div class="ref-file-item" data-file-id="${file.id}">
        <svg class="ref-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="ref-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="ref-file-size">${formatFileSize(file.size)}</span>
        <button class="btn-ref-file-preview" data-file-id="${file.id}" title="미리보기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="btn-ref-file-remove" data-file-id="${file.id}" title="제거">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');

    // 사용량 표시
    const total = getTotalRefSize();
    const count = editingReferenceFiles.length;
    if (count === 0) {
      usageEl.textContent = '';
      usageEl.className = 'ref-files-usage-bar';
    } else {
      usageEl.textContent = `${count}개 파일 · ${formatFileSize(total)} / ${formatFileSize(MAX_REF_TOTAL_SIZE)}`;
      const ratio = total / MAX_REF_TOTAL_SIZE;
      usageEl.className = 'ref-files-usage-bar visible' + (ratio >= 1 ? ' at-limit' : ratio >= 0.8 ? ' near-limit' : '');
    }

    // 이벤트 바인딩
    listEl.querySelectorAll('.btn-ref-file-preview').forEach(btn => {
      btn.addEventListener('click', () => previewReferenceFile(btn.dataset.fileId));
    });
    listEl.querySelectorAll('.btn-ref-file-remove').forEach(btn => {
      btn.addEventListener('click', () => removeReferenceFile(btn.dataset.fileId));
    });
  }

  function addReferenceFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = [...ALLOWED_TEXT_EXTENSIONS].map(ext => '.' + ext).join(',');
    input.addEventListener('change', () => handleFileSelection(input.files));
    input.click();
  }

  async function handleFileSelection(fileList) {
    const errors = [];
    for (const file of fileList) {
      const ext = getFileExtension(file.name);
      if (!ALLOWED_TEXT_EXTENSIONS.has(ext)) {
        errors.push(`"${file.name}" — 지원하지 않는 파일 형식입니다.`);
        continue;
      }
      if (editingReferenceFiles.length >= MAX_REF_FILE_COUNT) {
        errors.push(`최대 ${MAX_REF_FILE_COUNT}개까지만 첨부할 수 있습니다.`);
        break;
      }
      if (file.size > MAX_REF_FILE_SIZE) {
        errors.push(`"${file.name}" — 파일이 너무 큽니다 (${formatFileSize(file.size)}). 최대 ${formatFileSize(MAX_REF_FILE_SIZE)}.`);
        continue;
      }
      const content = await file.text();
      // 바이너리 파일 감지 (null 바이트 검사)
      if (content.slice(0, 8192).includes('\x00')) {
        errors.push(`"${file.name}" — 텍스트 파일이 아닙니다.`);
        continue;
      }
      if (getTotalRefSize() + content.length > MAX_REF_TOTAL_SIZE) {
        errors.push(`"${file.name}" — 총 용량 초과 (최대 ${formatFileSize(MAX_REF_TOTAL_SIZE)}).`);
        continue;
      }
      editingReferenceFiles.push({
        id: crypto.randomUUID(),
        name: file.name,
        content,
        size: content.length,
        addedAt: Date.now()
      });
    }
    renderReferenceFiles();
    if (errors.length) alert(errors.join('\n'));
  }

  function removeReferenceFile(fileId) {
    editingReferenceFiles = editingReferenceFiles.filter(f => f.id !== fileId);
    renderReferenceFiles();
  }

  function previewReferenceFile(fileId) {
    const file = editingReferenceFiles.find(f => f.id === fileId);
    if (!file) return;
    const modal = document.createElement('div');
    modal.className = 'ref-file-preview-modal';
    modal.innerHTML = `
      <div class="ref-file-preview-header">
        <span class="ref-file-preview-title">${escapeHtml(file.name)}</span>
        <button class="btn-preview-close" title="닫기">&times;</button>
      </div>
      <div class="ref-file-preview-body"><pre>${escapeHtml(file.content)}</pre></div>
    `;
    modal.querySelector('.btn-preview-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  function handleFileDrop(files) {
    handleFileSelection(files);
  }

  // ==================== 유틸리티 ====================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  init();
  return { ProjectManager, GroupManager };
})();
