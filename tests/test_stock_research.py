import importlib.util
import json
import unittest
import tempfile
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('research', Path(__file__).resolve().parents[1] / 'scripts/run_stock_research.py')
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


class ResearchAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.req = {'policy': R.POLICY, 'profile': R.PROFILE, 'symbol': '6274.TWO', 'parentId': 'root',
                    'question': '研究台燿營收與現金流之間的差異', 'approveOnce': True}
        self.archive = {'nodes': []}
        self.fundamentals = {'stocks': [{'symbol': '6274.TWO', 'research_tree': [{'id': 'cash'}]}]}

    def event(self):
        return {'action': 'opened', 'issue': {'number': 10, 'user': {'login': 'kang0102'},
            'title': '[AI 研究授權] 6274.TWO', 'body': '```json\n' + json.dumps(self.req) + '\n```'}}

    def call(self, event=None, actor='kang0102', attempt=1):
        return R.authorize(event or self.event(), 'kang0102/TimeBoxing', actor, attempt,
                           [{'symbol': '6274.TWO'}], self.archive, self.fundamentals)

    def test_explicit_owner_approval_only(self):
        self.assertEqual(self.call()[0]['symbol'], '6274.TWO')
        with self.assertRaises(ValueError): self.call(actor='visitor')
        self.req['approveOnce'] = False
        with self.assertRaises(ValueError): self.call()

    def test_reopening_edits_and_reruns_cannot_authorize(self):
        for action in ('edited', 'reopened', 'labeled'):
            event = self.event(); event['action'] = action
            with self.assertRaises(ValueError): self.call(event)
        with self.assertRaises(ValueError): self.call(attempt=2)

    def test_duplicate_and_cross_stock_parents_rejected(self):
        self.archive['nodes'] = [{'issue': 10}]
        with self.assertRaises(ValueError): self.call()
        self.archive['nodes'] = [{'issue': 9, 'id': 'issue-9', 'symbol': '2454.TW', 'status': 'completed'}]
        self.req['parentId'] = 'issue-9'
        with self.assertRaises(ValueError): self.call()
        self.req['parentId'] = 'seed-cash'
        self.assertEqual(self.call()[0]['parentId'], 'seed-cash')
        self.req['parentId'] = 'seed-nope'
        with self.assertRaises(ValueError): self.call()

    def test_request_cannot_inject_model_budget_or_other_data(self):
        self.req['model'] = 'arbitrary'
        with self.assertRaises(ValueError): self.call()
        del self.req['model']; self.req['question'] = 'x' * 501
        with self.assertRaises(ValueError): self.call()

    def test_one_response_contains_synthesis_and_bounded_search(self):
        p = R.payload({'request': self.req, 'record': {}, 'prior': []})
        self.assertFalse(p['store']); self.assertEqual(p['max_tool_calls'], 6)
        self.assertEqual(p['max_output_tokens'], 12000); self.assertEqual(len(p['tools']), 1)
        self.assertIn('synthesis', p['text']['format']['schema']['required'])

    def test_facts_without_observed_sources_are_downgraded(self):
        report = {'conclusion': '待驗證', 'evidence': [
            {'kind': 'fact', 'claim': '已查資料', 'date': '2026 Q2', 'source_urls': ['https://example.com/official']},
            {'kind': 'fact', 'claim': '未查資料', 'date': '', 'source_urls': ['https://invented.com']}],
            'branches': [], 'next_checks': [], 'synthesis': {'summary': 'test', 'established': [], 'conflicts': [], 'unanswered': [], 'next_priority': '查原文'}}
        response = {'status': 'completed', 'output': [
            {'type': 'web_search_call', 'action': {'sources': [{'url': 'https://example.com/official'}]}},
            {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(report)}]}]}
        result, calls = R.extract_report(response)
        self.assertEqual(calls, 1); self.assertEqual(result['evidence'][1]['kind'], 'gap')
        self.assertEqual(result['evidence'][0]['sources'][0]['url'], 'https://example.com/official')
        response['status'] = 'incomplete'
        with self.assertRaises(ValueError): R.extract_report(response)

    def test_memory_only_output_is_not_a_completed_new_study(self):
        with self.assertRaises(ValueError): R.extract_report({'status': 'completed', 'output': []})
        self.assertFalse(R.https('javascript:alert(1)')); self.assertFalse(R.https('https://u:p@example.com'))

    def test_failed_paid_request_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, context = Path(directory)/'archive.json', Path(directory)/'context.json'
            node = {'id': 'issue-10', 'status': 'running'}
            R.write(archive, {'nodes': [node]}); R.write(context, {'node': node, 'request': self.req})
            with patch.object(R, 'ARCHIVE', archive), patch.object(R, 'CONTEXT', context), patch.dict(R.os.environ, {'OPENAI_API_KEY': 'test-only'}), patch.object(R, 'request_json', side_effect=TimeoutError()) as network:
                R.finish(); self.assertEqual(network.call_count, 1)
                self.assertEqual(R.read(archive)['nodes'][0]['status'], 'failed')
                with self.assertRaises(ValueError): R.finish()
                self.assertEqual(network.call_count, 1)

    def test_setup_disabled_publishes_no_paid_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root/'rotation').mkdir()
            archive, context, event_file, output = root/'archive.json', root/'context.json', root/'event.json', root/'output.txt'
            R.write(archive, {'enabled': False, 'nodes': []}); R.write(event_file, self.event())
            R.write(root/'rotation/fundamental_research.json', self.fundamentals)
            R.write(root/'rotation/data.json', {'stocks': [{'symbol': '6274.TWO'}]})
            env={'GITHUB_EVENT_PATH':str(event_file),'GITHUB_REPOSITORY':'kang0102/TimeBoxing','GITHUB_ACTOR':'kang0102','GITHUB_RUN_ATTEMPT':'1','GITHUB_OUTPUT':str(output),'GH_TOKEN':'test-only'}
            with patch.object(R, 'ROOT', root), patch.object(R, 'ARCHIVE', archive), patch.object(R, 'CONTEXT', context), patch.dict(R.os.environ, env), patch.object(R, 'request_json', side_effect=[{**self.event()['issue'], 'state':'open'}, [], {}]) as network:
                R.prepare()
                self.assertEqual(R.read(archive)['nodes'][0]['status'], 'needs_setup')
                self.assertIn('ready=false', output.read_text())
                self.assertTrue(all(c.args[0].startswith('https://api.github.com/') for c in network.call_args_list))


if __name__ == '__main__': unittest.main()
