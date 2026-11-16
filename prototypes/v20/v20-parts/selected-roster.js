/* Restore the independent V19 selected roster; browsing filters never trim it. */
(() => {
  const active = dealer => ['active', '1'].includes(String(dealer?.status ?? '').trim().toLowerCase());
  const selected = plan => (plan.selected || []).map(id => SEED.dealers.find(dealer => dealer.id === id)).filter(active);
  const priorFiltered = filtered;
  filtered = function() { return priorFiltered().filter(active); };
  const priorScope = scopeStep;
  scopeStep = function(config, plan) {
    st.status = '';
    const rows = selected(plan);
    const template = document.createElement('template');
    template.innerHTML = priorScope(config, {...plan, selected: rows.map(dealer => dealer.id)});
    template.content.querySelector('#dealerstatus')?.remove();
    template.content.querySelectorAll('[data-action="addfiltered"],[data-action="library"],[data-action="rosterup"]').forEach(button => button.remove());
    template.content.querySelectorAll('[data-select]').forEach(checkbox => {
      if (!rows.some(dealer => dealer.id === checkbox.dataset.select)) checkbox.disabled = true;
    });
    // Replace the legacy roster, retaining a separate card below the candidate table.
    [...template.content.querySelectorAll('.panel')].find(panel => panel.querySelector('h2')?.textContent.startsWith('最终名单'))?.remove();
    const panel = document.createElement('section');
    panel.className = 'panel v20-selected-roster';
    panel.setAttribute('aria-labelledby', 'v20-selected-roster-title');
    panel.innerHTML = `<div class="panelhead"><div><h2 id="v20-selected-roster-title">最终名单 · ${rows.length} 家</h2><div class="sub">已选经销商（仅 Active），不受上方搜索、SD / RSM 筛选和分页影响。</div></div><button data-action="selectedrosterdown">↓ 名单 Excel</button></div><div class="tablewrap" tabindex="0" role="region" aria-label="已选经销商名单，可滚动"><table aria-label="已选经销商名单"><thead><tr><th>编码</th><th>名称</th><th>SD</th><th>RSM</th><th>状态</th><th class="num">已分配（元）</th><th>操作</th></tr></thead><tbody>${rows.map(dealer => `<tr><td>${esc(dealer.id)}</td><td><button class="quiet small link" data-dealer="${esc(dealer.id)}">${esc(dealer.name)}</button></td><td>${esc(dealer.sd)}</td><td>${esc(dealer.rsm)}</td><td><span class="pill green">Active</span></td><td class="num">${fmt(plan.amounts[dealer.id] || 0)}</td><td><button class="small quiet" data-remove="${esc(dealer.id)}" aria-label="移除 ${esc(dealer.name)}">移除</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">尚未选择 Active 经销商</td></tr>'}</tbody><tfoot><tr class="totalrow"><td colspan="5">合计 · ${rows.length} 家</td><td class="num">${fmt(sum(rows.map(dealer => Number(plan.amounts[dealer.id]) || 0)))}</td><td></td></tr></tfoot></table></div><div class="chartnote">移除已获配经销商需确认，释放金额返回待分配；不会自动重算其他经销商金额。</div>`;
    template.content.append(panel);
    return template.innerHTML;
  };
  const rosterRows = function() {
    const plan = current();
    return [['经销商编码','经销商名称','SD','RSM','状态','已分配（元）'], ...selected(plan).map(dealer => [dealer.id,dealer.name,dealer.sd,dealer.rsm,'Active',Number(plan.amounts[dealer.id]) || 0])];
  };
  window.addEventListener('click', event => {
    if (!event.target.closest?.('[data-action="selectedrosterdown"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    download('已选经销商名单_'+st.version+'_'+st.id+'.xlsx', xlsx(rosterRows()));
  }, true);
  render();
})();
