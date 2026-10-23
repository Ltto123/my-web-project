const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('a late search response cannot overwrite the latest search', async () => {
  const pending = new Map();
  const grid = {innerHTML: '', classList: {add() {}, remove() {}}, setAttribute() {}, querySelector() {return null;}};
  const document = {querySelector: s => s === '#blog-grid' ? grid : null};
  const makeRequest = url => new Promise(resolve => pending.set(new URL(url).searchParams.get('search'), resolve));
  const context = vm.createContext({document, API_BASE:'http://localhost', getAuthHeaders:()=>({}), skeletonCards(){}, AbortController, console, URL, fetch: async url => ({json:()=>makeRequest(url)}), requestJson: makeRequest, renderLoadError(){}});
  const source = fs.readFileSync('frontend/main.js','utf8').replace(/init\(\);\s*$/, '');
  vm.runInContext(source,context);
  vm.runInContext('renderBlogGrid = () => {}; renderPagination = () => {};',context);
  const slow = vm.runInContext('loadPostsFromServer("old", 1)',context);
  const fast = vm.runInContext('loadPostsFromServer("new", 1)',context);
  await new Promise(resolve => setImmediate(resolve));
  pending.get('new')({code:0,data:{posts:[{id:2}],total:1}});
  await fast;
  pending.get('old')({code:0,data:{posts:[{id:1}],total:1}});
  await slow;
  assert.equal(vm.runInContext('blogPosts[0].id',context),2);
});
