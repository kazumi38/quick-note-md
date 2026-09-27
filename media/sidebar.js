(function () {
  const app = document.getElementById('app');
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || { expanded: {} };

  function render(todos) {
    app.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Todo';
    app.append(heading);
    for (const todo of todos) {
      const card = document.createElement('article');
      card.className = 'todo';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'todo-title';
      button.setAttribute('aria-expanded', String(Boolean(state.expanded[todo.id])));
      button.textContent = `${todo.status}: ${todo.title}${todo.labels.length ? ` [${todo.labels.join(', ')}]` : ''}${todo.dueDate ? `（対応日 ${todo.dueDate}）` : ''}`;
      button.addEventListener('click', () => {
        state.expanded[todo.id] = !state.expanded[todo.id];
        vscode.setState(state);
        vscode.postMessage({ kind: 'select', id: todo.id });
        render(todos);
      });
      card.append(button);
      if (state.expanded[todo.id]) {
        const detail = document.createElement('section');
        detail.className = 'todo-detail';
        detail.setAttribute('aria-label', `${todo.title} の詳細`);
        const body = document.createElement('p');
        body.textContent = todo.bodyMarkdown || '本文なし';
        detail.append(body);
        for (const reply of todo.replies) {
          const replyNode = document.createElement('p');
          replyNode.textContent = `リプライ ${reply.id}: ${reply.text}`;
          detail.append(replyNode);
        }
        const source = document.createElement('button');
        source.type = 'button';
        source.textContent = '生 Markdown を表示';
        source.addEventListener('click', () => vscode.postMessage({ kind: 'source', id: todo.id }));
        detail.append(source);
        card.append(detail);
      }
      app.append(card);
    }
  }

  window.addEventListener('message', event => {
    if (event.data && event.data.kind === 'snapshot' && Array.isArray(event.data.todos)) render(event.data.todos);
  });
  vscode.postMessage({ kind: 'ready' });
}());
