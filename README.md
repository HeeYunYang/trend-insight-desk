# 트렌드 데스크 (웹앱)

매일 아침 세계 정세, 지표, 큰 이야기, 트렌드 장부를 정리하는 개인 대시보드의 읽기 전용 웹 버전입니다.

- 화면: `index.html` (Claude 아티팩트 페이지에서 `tools/build_site.py`로 생성)
- 데이터: `data/bundle.json` (매일 아침 Claude 스케줄 작업이 갱신)
- 수정(트렌드 채택, 예측 기록, 현장 신호 입력)은 Claude의 트렌드 데스크 페이지에서 합니다.

## 갱신 방법
```
python3 scripts/build_bundle.py <ArtifactData 덤프 폴더> data/bundle.json
python3 tools/build_site.py <아티팩트 html> index.html
node tools/test_site.js http://127.0.0.1:8765/   # 로컬 서버를 띄운 뒤
```
