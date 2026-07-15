# Claude Code 가이드라인

## 복잡도 (Complexity)
- 파일은 1000 LOC(Line of Code)를 초과해서는 안 된다
- 함수는 60 LOC를 초과해서는 안 된다
- 순환 복잡도(Cyclomatic Complexity)는 10 이하이어야 한다
- 중첩 깊이는 3 이하로 유지한다 (early return과 guard clause 사용)
- 함수당 최대 파라미터 수는 5개까지 허용한다 (그 이상은 Parameter Object 사용)

## 아키텍처 (Architecture)
- 순환 의존성(Cyclic Dependency)을 금지한다
- 엄격한 레이어 경계를 강제한다 — 상위 레이어는 바로 아래 레이어만 호출 가능
- 로깅, 인증, 메트릭 같은 횡단 관심사(Cross-cutting Concerns)는 전용 미들웨어/인터셉터를 통해 처리하고, 코드 곳곳에 흩뿌리지 않는다
- 인터페이스와 구현을 분리한다 — 단, 단일 사용 코드에서 추상화가 가치가 없을 경우는 제외
- 모듈은 하나의 책임만 가진다 (단일 책임 원칙, SRP)
- 구체 구현이 아닌 추상화에 의존한다 (Dependency Inversion) — 단, 단순하거나 단일 사용 컴포넌트는 제외
- 컴포넌트는 내부 구현을 직접 참조하지 말고 정의된 인터페이스를 통해 통신해야 한다
- God Object를 피한다 — 하나의 클래스/모듈이 여러 도메인 개념을 소유하지 않도록 한다
- DB 스키마, API 계약, 파일 포맷 같은 인프라 세부사항은 어댑터 뒤로 숨긴다
- 설정(Configuration)은 외부화한다 — 환경별 로직을 비즈니스 로직에 하드코딩하지 않는다
- Feature Flag는 중앙에서 관리하고 코드 곳곳에 분산시키지 않는다
- Open/Closed 원칙을 선호한다 — 기존 코드를 수정하기보다 새 코드로 기능을 확장한다

## 도메인 주도 설계 (Domain-Driven Design)

### 전략적 설계 (Strategic Design)
- Bounded Context를 명확하게 식별하고 정의한다
- Bounded Context 간 관계를 문서화하기 위해 Context Map을 정의한다
- Bounded Context 간 도메인 모델 공유를 피한다 — 각 컨텍스트별로 별도 모델을 사용한다
- 각 Bounded Context마다 Ubiquitous Language를 정의하고 코드, 테스트, 문서 전반에서 일관되게 사용한다
- Bounded Context 간 통신은 이벤트 기반으로 수행한다 (직접적인 Cross-domain 호출 지양)

### 전술적 설계 (Tactical Design)
- Aggregate를 식별하고 Aggregate 경계 내부에서 불변 조건(invariant)을 보장한다
- Aggregate는 반드시 Aggregate Root를 통해서만 접근한다 — 내부 엔티티를 직접 참조하지 않는다
- Aggregate는 작게 유지한다 — 큰 Aggregate는 경합(contention)과 성능 문제를 유발한다
- 식별자가 없는 개념에는 Value Object를 사용한다
  - 예: Money, Address, DateRange
- 도메인 개념에는 primitive 타입보다 Value Object를 우선 사용한다
  - Primitive Obsession 방지

### 도메인 모델 (Domain Model)
- 도메인 로직은 반드시 도메인 레이어에 존재해야 한다
  - 서비스, 컨트롤러, 리포지토리에 넣지 않는다
- 도메인 레이어는 인프라 레이어에 의존해서는 안 된다
- 빈약한 도메인 모델(Anemic Domain Model)을 피한다
  - 엔티티는 데이터만 보관하지 말고 행동(behavior)을 포함해야 한다
- 도메인 이벤트는 과거에 발생한 사실을 표현해야 한다
  - 예: `OrderPlaced`, `PaymentFailed`
- 도메인 이벤트는 불변(immutable)이어야 한다

### 리포지토리 (Repository)
- Repository는 엔티티별이 아니라 Aggregate Root별로 하나씩 둔다
- Repository 인터페이스는 도메인 레이어에 정의하고 구현은 인프라 레이어에 둔다

### 애플리케이션 레이어 (Application Layer)
- 애플리케이션 서비스는 유스케이스를 조율(orchestrate)하는 역할만 수행한다
  - 도메인 로직을 포함해서는 안 된다
- 애플리케이션 서비스 메서드는 하나의 유스케이스만 담당한다

## 테스트 (Testing)
- 모든 public 메서드는 테스트가 필요하다
- 버그 수정 시 반드시 회귀 테스트(regression test)를 포함해야 한다
- 테스트 이름은 구현이 아니라 동작을 설명해야 한다
  - 예: `input이 null일 때 빈 리스트를 반환해야 한다`
  - 나쁜 예: `test_null`
- 비즈니스 로직의 코드 커버리지는 80% 이상을 목표로 한다
- 단위 테스트는 외부 시스템(DB, 네트워크, 파일 시스템)에 의존해서는 안 된다

## 코드 스타일 (Code Style)
- 상속보다 조합(composition)을 선호한다
- 매직 넘버를 피하고 명명된 상수를 사용한다
- 불변 객체(Immutable Object)를 선호한다
- 의미 있는 이름을 사용한다
  - 변수: 명사
  - 함수: 동사
  - boolean: `is`, `has`, `can` 접두사 사용
- 당신의 변경으로 인해 생긴 죽은 코드(dead code)는 제거한다
  - 단, 기존에 이미 존재하던 죽은 코드는 삭제하지 말고 언급만 한다

## 오류 처리 (Error Handling)
- 현실적으로 발생 가능한 예외를 절대 조용히 무시하지 않는다
  - 단, 불가능한 상황까지 과도한 예외 처리를 추가하지는 않는다
- 항상 충분한 맥락과 함께 로그를 남긴다
  - 무엇이 실패했는지
  - 어디서 실패했는지
  - 왜 실패했는지
- 복구 가능한 오류와 복구 불가능한 오류를 명확히 구분한다
- 가능하면 raw exception 대신 타입화된 오류를 반환한다

## 보안 (Security)
- 자격 증명(credentials), 토큰, 시크릿을 하드코딩하지 않는다
- 모든 외부 입력은 sanitize 및 validate 한다
- 민감한 데이터(PII, 토큰, 비밀번호)를 로그에 남기지 않는다

## 의존성 관리 (Dependencies)
- 사용자 확인 없이 새로운 외부 의존성을 추가하지 않는다
- 단순 유틸리티는 third-party보다 표준 라이브러리(stdlib)를 우선 사용한다
- 새 패키지를 추가할 때는 버전을 고정(pin)한다
- 보안 패치를 위해 의존성을 정기적으로 점검하고 업데이트한다

## 작업 범위 (Task Scope)
- 작업 범위를 벗어난 리팩토링을 하지 않는다
- 명시적으로 요청되지 않은 기능을 추가하지 않는다
- 공용 유틸리티나 인터페이스를 수정하기 전에는 반드시 사용자에게 확인받는다

## 확인 체크포인트 (Confirmation Checkpoints)
- 파일 삭제 전에는 사용자에게 확인받는다
- Public API 시그니처 변경 전에는 사용자에게 확인받는다
- 3개 이상의 파일 수정이 필요한 작업은 실행 전에 변경 계획을 먼저 제시한다

## Git / 변경 관리 (Git / Change Hygiene)
- 하나의 논리적 변경만 하나의 커밋에 포함한다
- 리팩토링과 기능 추가를 같은 변경에 섞지 않는다
- TODO 주석에는 반드시 티켓/이슈 번호를 함께 남긴다
  - 단순 TODO 금지

## 커뮤니케이션 스타일 (Communication Style)
- 의도가 불확실하면 구현 전에 질문한다
- 작업 완료 후 무엇을 왜 변경했는지 요약한다
- 구현 중 가정한 내용이 있다면 명시적으로 알린다