document.addEventListener('DOMContentLoaded', () => {
  const costInput = document.getElementById('cost');
  const convValueInput = document.getElementById('convValue');
  const profileSelect = document.getElementById('profileSelect');
  const statusMsg = document.getElementById('statusMsg');
  const resultsContainer = document.getElementById('resultsContainer');
  const failedList = document.getElementById('failedList');

  const newProfileBtn = document.getElementById('newProfileBtn');
  const delProfileBtn = document.getElementById('delProfileBtn');
  const setDefaultBtn = document.getElementById('setDefaultBtn');

  // Default profiles defined by user
  const defaultProfiles = [
    { id: '1', name: 'USD', cost: '1', convValue: '0.59' },
    // Fixed VND cost: user meant 26000, not 26 (26 VND is basically 0)
    { id: '2', name: 'VND', cost: '26000', convValue: '0.59' }
  ];

  let profiles = [];
  let defaultProfileId = '1';
  let currentProfileId = '1';

  // Smart parser to handle 26,000 | 26.000 | 0,59 | 0.59
  const parseInput = (val) => {
    if (typeof val !== 'string') return parseFloat(val);
    let v = val.trim();
    
    const lastDot = v.lastIndexOf('.');
    const lastComma = v.lastIndexOf(',');
    
    if (lastComma > lastDot) {
      // Comma is the last separator
      const parts = v.split(',');
      const lastPart = parts[parts.length - 1];
      if (lastPart.length === 3 && parts.length > 1) {
        // Assume comma is thousands separator (e.g. 26,000)
        v = v.replace(/,/g, '');
      } else {
        // Assume comma is decimal (e.g. 0,59)
        v = v.replace(/\./g, '').replace(',', '.');
      }
    } else if (lastDot > lastComma) {
      // Dot is the last separator
      const parts = v.split('.');
      const lastPart = parts[parts.length - 1];
      if (lastPart.length === 3 && parts.length > 1) {
        // Assume dot is thousands separator (e.g. 26.000)
        v = v.replace(/\./g, '');
      } else {
        // Assume dot is decimal (e.g. 1.87)
        v = v.replace(/,/g, '');
      }
    }
    
    return parseFloat(v);
  };

  const showStatus = (msg, color = '#188038') => {
    statusMsg.textContent = msg;
    statusMsg.style.color = color;
    setTimeout(() => statusMsg.textContent = '', 2000);
  };

  const saveToStorage = () => {
    chrome.storage.local.set({
      profiles: profiles,
      defaultProfileId: defaultProfileId
    });
  };

  const renderProfiles = () => {
    profileSelect.innerHTML = '';
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.id === defaultProfileId ? ' (Default)' : '');
      profileSelect.appendChild(opt);
    });
    profileSelect.value = currentProfileId;
  };

  const loadProfileData = (id) => {
    const p = profiles.find(x => x.id === id);
    if (p) {
      costInput.value = p.cost;
      convValueInput.value = p.convValue;
    }
  };

  // Initialization
  chrome.storage.local.get(['profiles', 'defaultProfileId'], (result) => {
    profiles = result.profiles || defaultProfiles;
    defaultProfileId = result.defaultProfileId || '1';
    
    // Fallback if default profile was deleted previously
    if (!profiles.find(p => p.id === defaultProfileId)) {
      defaultProfileId = profiles[0].id;
    }
    
    currentProfileId = defaultProfileId;
    renderProfiles();
    loadProfileData(currentProfileId);
  });

  // Profile Change Event
  profileSelect.addEventListener('change', (e) => {
    currentProfileId = e.target.value;
    loadProfileData(currentProfileId);
  });

  // Create Profile
  newProfileBtn.addEventListener('click', () => {
    const name = prompt('Enter new profile name:');
    if (name && name.trim()) {
      const newId = Date.now().toString();
      profiles.push({
        id: newId,
        name: name.trim(),
        cost: costInput.value,
        convValue: convValueInput.value
      });
      currentProfileId = newId;
      saveToStorage();
      renderProfiles();
      showStatus('Profile created!');
    }
  });

  // Delete Profile
  delProfileBtn.addEventListener('click', () => {
    if (profiles.length <= 1) {
      alert('Cannot delete the last profile.');
      return;
    }
    if (confirm('Are you sure you want to delete this profile?')) {
      profiles = profiles.filter(p => p.id !== currentProfileId);
      
      // If deleted profile was default, fallback to first
      if (defaultProfileId === currentProfileId) {
        defaultProfileId = profiles[0].id;
      }
      
      currentProfileId = profiles[0].id;
      saveToStorage();
      renderProfiles();
      loadProfileData(currentProfileId);
      showStatus('Profile deleted!', '#d93025');
    }
  });

  // Set Default
  setDefaultBtn.addEventListener('click', () => {
    defaultProfileId = currentProfileId;
    saveToStorage();
    renderProfiles();
    showStatus('Set as default profile!');
  });

  // Update Profile Config
  document.getElementById('saveBtn').addEventListener('click', () => {
    const p = profiles.find(x => x.id === currentProfileId);
    if (p) {
      p.cost = costInput.value;
      p.convValue = convValueInput.value;
      saveToStorage();
      showStatus('Profile config saved!');
    }
  });

  const executeAction = async (doTick) => {
    const costValue = parseInput(costInput.value);
    const convValue = parseInput(convValueInput.value);

    statusMsg.textContent = 'Analyzing data...';
    statusMsg.style.color = '#1a73e8';
    resultsContainer.style.display = 'none';
    failedList.innerHTML = '';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      const handleResponse = (response) => {
        if (!response || response.status !== 'success') {
          showStatus('Error: Data not found. Please reload the Google Ads page.', '#d93025');
          return;
        }
        
        statusMsg.style.color = '#188038';
        if (response.failedCountries.length === 0) {
          statusMsg.textContent = 'Great! No locations missed the target.';
        } else {
          statusMsg.textContent = `Found ${response.failedCountries.length} locations.`;
          if (doTick) {
            statusMsg.textContent += ' Auto-ticked.';
          }
          resultsContainer.style.display = 'block';
          
          response.failedCountries.forEach(country => {
            const tr = document.createElement('tr');
            
            const tdName = document.createElement('td');
            tdName.textContent = country.name;
            
            const tdCost = document.createElement('td');
            tdCost.textContent = country.cost;
            
            const tdConv = document.createElement('td');
            tdConv.textContent = country.conv;
            
            const tdAllConv = document.createElement('td');
            tdAllConv.textContent = country.allConv;
            
            tr.appendChild(tdName);
            tr.appendChild(tdCost);
            tr.appendChild(tdConv);
            tr.appendChild(tdAllConv);
            
            failedList.appendChild(tr);
          });
        }
      };

      // Ensure content script is injected then message
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }, () => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'highlight',
            costThreshold: costValue,
            convValueThreshold: convValue,
            doTick: doTick
          }, handleResponse);
        }, 150);
      });
    }
  };

  // Run (Highlight only)
  document.getElementById('highlightBtn').addEventListener('click', () => {
    executeAction(false);
  });

  // Quick Tick (Highlight + Tick)
  document.getElementById('tickBtn').addEventListener('click', () => {
    executeAction(true);
  });
});
