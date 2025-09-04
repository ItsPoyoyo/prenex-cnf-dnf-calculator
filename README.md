# prenex-cnf-dnf-calculator
Converts logical expressions written in LaTeX into different normal forms: CNF, DNF, Prenex Form, Clausal Form, and Horn Clauses, with mathematical rendering using MathJax
### Feito Por Hussein Ali El Gazouini.
#### gazouinihussein@gmail.com

# Logica e Pesquisa de como prenex-cnf-dnf-calculator foi feito Passo a Passo.


1. **Forma Prenex** - Mover todos os quantificadores para a esquerda
2. **Forma Normal Conjuntiva (FNC)** - E de OU's
3. **Forma Normal Disjuntiva (FND)** - OU de E's  
4. **Forma Cláusal** - Converter para representação de cláusulas
5. **Cláusulas de Horn** - Forma especial para programação lógica


## Primeiro passo:

### Regras:
1. **Se a variável não aparece em outro lugar** -> Pode mover o quantificador
2. **Se a variável aparece em outro lugar** -> Renomeie primeiro, depois mova
3. **Sempre mantenha a mesma lógica** -> Não mude o significado

#### Exemplo 1: Caso Simples

```
Fórmula: ∀x(P(x) ∧ ∃y Q(y))

Passo 1: Identificar quantificadores
- ∀x está na frente
- ∃y está dentro

Passo 2: Analisar ∃y
- y aparece em Q(y)? SIM
- y aparece em P(x)? NÃO
- Posso mover ∃y? SIM! (y não interfere em P(x))

Passo 3: Mover ∃y para frente
Resultado: ∀x ∃y (P(x) ∧ Q(y))
```


#### Exemplo 2: Com Conflito de Variáveis
```
Fórmula: ∀x(P(x) ∧ ∃x Q(x))

Passo 1: Identificar quantificadores
- ∀x está na frente
- ∃x está dentro (CONFLITO! Mesma variável x)

Passo 2: Renomear para evitar conflito
- Trocar ∃x por ∃y
- Fica: ∀x(P(x) ∧ ∃y Q(y))

Passo 3: Mover ∃y
Resultado: ∀x ∃y (P(x) ∧ Q(y))
```

#### Exemplo 3: Variável Livre (Não Pode Mover)
```
Fórmula: ∀x(P(x) ∧ Q(x,y))

Passo 1: Identificar quantificadores
- ∀x está na frente
- Não há outros quantificadores

Passo 2: Verificar se y é livre
- y aparece em Q(x,y) mas não está ligada por nenhum quantificador
- y é uma variável LIVRE

Passo 3: Resultado
- Não há nada para mover
- Resultado: ∀x(P(x) ∧ Q(x,y))
```

### Atencao
- **Conflito de nomes**: Sempre renomeie antes de mover
- **Variável livre**: Se não está ligada por quantificador, não pode mover
- **Ordem dos quantificadores**: Mantenha a ordem lógica

