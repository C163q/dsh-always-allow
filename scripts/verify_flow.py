#!/usr/bin/env python3
"""Exercise persistent sandbox approval in a real Web UI and verify durable events.

Requires a booted isolated DSH_HOME. Only runs a local Node program that prints a marker.
The real selected model must follow the explicit single-tool-call prompts.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from live import COMPOSER, PANEL_CARD, launch_page, load_state, token_from_log


def read_events(path):
    if path.suffix == '.zstd':
        result = subprocess.run(['zstd', '-dc', str(path)], capture_output=True, check=True)
        raw = result.stdout.decode()
    else:
        raw = path.read_text()
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def session_files(home):
    return list((home / 'sessions').rglob('session.v4.jsonl*'))


def prompt(command, nonce):
    return (f'这是安全审批插件的回归测试 {nonce}。请严格只调用一次 bash 工具：'
            f'command={json.dumps(command)}, description="安全审批回归测试", '
            'sandbox_permissions="danger-full-access", justification="测试永久前缀审批"。'
            '命令只输出测试标记或当前目录，不修改文件。不要换命令，不要使用其他工具。'
            '工具返回后仅报告结果；若被拒绝立即停止。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int)
    parser.add_argument('--log')
    parser.add_argument('--out', default='.tmp/browser')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    home = Path(os.environ['DSH_HOME'])
    target = Path(args.out); target.mkdir(parents=True, exist_ok=True)
    if args.port:
        url = f'http://127.0.0.1:{args.port}/?token={token_from_log(Path(args.log))}'
    else:
        url = load_state()['url']
    probe = target / f'probe-{time.time_ns()}.cjs'
    probe.write_text('process.stdout.write(process.argv[2])\n')
    rejected_probe = target / f'reject-{time.time_ns()}.cjs'
    rejected_probe.write_text('process.stdout.write("AA_SHOULD_NOT_RUN")\n')
    prefix = f'node {probe.resolve()}'
    before = {str(p): p.stat().st_mtime_ns for p in session_files(home)}
    p,b,page,errors = launch_page(ignored_console_paths=('/open-in-app/icon/filemanager',))
    report = {'steps':[], 'errors':errors, 'failedResources':[]}
    page.on('response', lambda r: report['failedResources'].append({'status':r.status,'url':r.url.split('?')[0]}) if r.status>=400 else None)
    session = None
    try:
        page.goto(url, wait_until='networkidle', timeout=60000)
        page.wait_for_selector(COMPOSER, timeout=60000)
        page.evaluate('''() => {
          window.__aaPanels = 0;
          new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1 && (node.matches('.always-allow__card') || node.querySelector('.always-allow__card'))) window.__aaPanels++;
          }}).observe(document.body, {childList:true,subtree:true});
        }''')
        for index,(command,action) in enumerate([
            (f'{prefix} AA_SAFE_FIRST', 'save'),
            (f'{prefix} AA_SAFE_REPEAT', 'auto'),
            (f'node {rejected_probe.resolve()} AA_SHOULD_NOT_RUN', 'reject'),
        ]):
            prior = read_events(session) if session else []
            sequence = max((e.get('seq',-1) for e in prior),default=-1)
            panels = page.evaluate('window.__aaPanels')
            composer = page.locator(COMPOSER).first
            composer.wait_for(state='visible',timeout=60000)
            composer.fill(prompt(command, f'{time.time_ns()}-{index}'))
            composer.press('Enter')
            start=time.monotonic()
            while session is None:
                changed=[f for f in session_files(home) if f.stat().st_mtime_ns != before.get(str(f))]
                if changed:
                    session=max(changed,key=lambda f:f.stat().st_mtime_ns)
                    report['session']=str(session)
                if time.monotonic()-start>args.timeout: raise AssertionError('no durable session appeared')
                page.wait_for_timeout(300)
            if action != 'auto':
                page.locator(PANEL_CARD).wait_for(state='visible',timeout=args.timeout*1000)
                if action == 'save':
                    button=page.get_by_role('button',name='永久放行',exact=False)
                    button.wait_for(state='visible')
                    while not button.is_enabled():
                        if time.monotonic()-start>args.timeout: raise AssertionError('save button never enabled')
                        page.wait_for_timeout(200)
                    assert 'danger-full-access' in page.locator(PANEL_CARD).inner_text()
                    page.screenshot(path=str(target/'01-manual-approval.png'))
                    print('saving explicit grant:',button.inner_text(),flush=True)
                    with page.expect_response(lambda r:'/always-allow/save' in r.url) as saved:
                        button.click()
                    result=saved.value.json()
                    assert result['ok'],result
                    report['ruleFile']=result['value']['file']
                else:
                    page.screenshot(path=str(target/'03-unmatched-approval.png'))
                    page.get_by_role('button',name='拒绝',exact=True).click()
            while True:
                events=[e for e in read_events(session) if e.get('seq',-1)>sequence]
                results=[e for e in events if e.get('type')=='tool/result']
                ended=any(e.get('type')=='turn/end' for e in events)
                if results and ended: break
                if action=='auto' and page.locator(PANEL_CARD).count():
                    page.screenshot(path=str(target/'FAIL-auto-still-asks.png'))
                    raise AssertionError('matching command still asks for human approval')
                if time.monotonic()-start>args.timeout:
                    page.screenshot(path=str(target/'FAIL-timeout.png'))
                    raise AssertionError(f'no completed tool result within timeout; event types: {[e.get("type") for e in events][-12:]}')
                page.wait_for_timeout(350)
            asked=[e['data'] for e in events if e.get('type')=='approval/asked']
            decided=[e['data'] for e in events if e.get('type')=='approval/decided']
            assert len(asked)==1 and len(decided)==1,(asked,decided)
            assert decided[0]['outcome']==('rejected' if action=='reject' else 'allowed-once'),decided
            assert asked[0]['id']==decided[0]['id']
            if action=='auto':
                assert page.evaluate('window.__aaPanels')==panels,'an approval panel appeared during automatic approval'
                assert any(r['data']['message'].get('isError') is False and r['data']['message']['content']==[{'type':'text','text':'AA_SAFE_REPEAT'}] for r in results),results
                page.screenshot(path=str(target/'02-automatic-completion.png'))
            if action=='save': assert any(r['data']['message'].get('isError') is False and r['data']['message']['content']==[{'type':'text','text':'AA_SAFE_FIRST'}] for r in results),results
            if action=='reject': assert all(r['data']['message'].get('isError') is True and 'rejected' in json.dumps(r['data']['message']['content']) and 'AA_SHOULD_NOT_RUN' not in json.dumps(r['data']['message']['content']) for r in results),results
            step={'command':command,'action':action,'approval':decided[0]['outcome'],'toolResults':len(results),'panelAppearances':page.evaluate('window.__aaPanels')-panels}
            report['steps'].append(step)
            print(json.dumps(step),flush=True)
        from urllib.parse import urlsplit
        unexpected = [r for r in report['failedResources'] if not (r['status'] == 404 and urlsplit(r['url']).path == '/open-in-app/icon/filemanager')]
        assert not errors and not unexpected, (errors, unexpected)
        report['session']=str(session)
        print('PASS: manual save, automatic repeat, and unmatched rejection verified against session events',flush=True)
    finally:
        report['errors']=errors
        (target/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
        page.screenshot(path=str(target/'final.png'))
        b.close();p.stop()


if __name__=='__main__':
    main()
