document.addEventListener('DOMContentLoaded', () => {
  const costInput = document.getElementById('cost');
  const convValueInput = document.getElementById('convValue');
  const statusMsg = document.getElementById('statusMsg');
  const resultsContainer = document.getElementById('resultsContainer');
  const failedList = document.getElementById('failedList');

  // Helper to parse numbers even if user types comma (0,6 -> 0.6)
  const parseInput = (val) => {
    if (typeof val === 'string') {
      return parseFloat(val.replace(',', '.'));
    }
    return parseFloat(val);
  };

  // Load defaults
  chrome.storage.local.get(['defaultCost', 'defaultConvValue'], (result) => {
    if (result.defaultCost !== undefined) costInput.value = result.defaultCost;
    if (result.defaultConvValue !== undefined) convValueInput.value = result.defaultConvValue;
  });

  // Save defaults
  document.getElementById('saveBtn').addEventListener('click', () => {
    chrome.storage.local.set({
      defaultCost: costInput.value,
      defaultConvValue: convValueInput.value
    }, () => {
      statusMsg.textContent = 'Default config saved!';
      statusMsg.style.color = '#188038';
      setTimeout(() => statusMsg.textContent = '', 2000);
    });
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
          statusMsg.textContent = 'Error: Data not found. Please reload the Google Ads page.';
          statusMsg.style.color = '#d93025';
          return;
        }
        
        statusMsg.style.color = '#188038';
        if (response.failedCountries.length === 0) {
          statusMsg.textContent = 'Great! No locations missed the target (or data does not meet both conditions).';
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
        // Slight delay to avoid race conditions with listener registration
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
